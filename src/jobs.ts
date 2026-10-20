import type { ContentBlock, Job } from './model';
import { NotionError, sourceBlock, validId } from './notion';

interface Writer {
  createPage: (
    destination: Job['destination'],
    title: string,
    source: string,
  ) => Promise<{ id: string; url: string }>;
  append: (id: string, blocks: ContentBlock[]) => Promise<void>;
  children: (id: string) => Promise<ContentBlock[]>;
}
// Ignore API-added defaults and merge equivalent text runs when comparing saved content.
function normalizedRich(items: any[] = []) {
  const runs: { text: string; style: string }[] = [];
  for (const item of items) {
    const style = JSON.stringify({
      link: item.text?.link?.url ?? null,
      ...Object.fromEntries(
        ['bold', 'italic', 'code', 'underline', 'strikethrough'].map((k) => [
          k,
          !!item.annotations?.[k],
        ]),
      ),
    });
    const text = item.text?.content ?? item.plain_text ?? '';
    if (runs.at(-1)?.style === style) runs[runs.length - 1].text += text;
    else runs.push({ text, style });
  }
  return runs;
}

export function fingerprint(block: ContentBlock): string {
  const body = block[block.type] ?? {};
  return JSON.stringify({
    type: block.type,
    text: normalizedRich(body.rich_text),
    language: body.language,
    image: body.external?.url,
    caption: normalizedRich(body.caption),
  });
}

// Compare the saved prefix before resuming, so an accepted write is never appended twice.
async function reconcile(job: Job, client: Pick<Writer, 'children'>) {
  const actual = await client.children(job.pageId!);
  const expected = [sourceBlock(job.source), ...job.blocks];
  if (
    actual.length === 0 ||
    actual.length > expected.length ||
    actual.some((b, i) => fingerprint(b) !== fingerprint(expected[i]))
  ) {
    throw new Error(
      'The saved page content has changed or does not match this ' +
        'clip. Review it in Notion before continuing.',
    );
  }
  if (actual.length - 1 < job.next)
    throw new Error('Previously saved content is missing. Review the page in Notion.');
  job.next = actual.length - 1;
  delete job.inFlight;
}

// Journal each write before sending it; preserve uncertain outcomes for explicit recovery.
export async function runJob(
  job: Job,
  client: Writer,
  persist: () => Promise<void>,
): Promise<void> {
  if (job.status === 'done') return;
  if ((job.status === 'creating' || job.status === 'uncertain') && !job.pageId) {
    job.status = 'uncertain';
    job.error =
      'Notion may have created this page. Find it in Notion and use ' +
      'its URL to resume. No second page was created.';
    await persist();
    return;
  }
  try {
    if (job.pageId) await reconcile(job, client);
    else {
      job.status = 'creating';
      delete job.error;
      await persist();
      const page = await client.createPage(job.destination, job.title, job.source);
      job.pageId = page.id;
      job.pageUrl = page.url;
      job.status = 'writing';
      await persist();
    }
    while (job.next < job.blocks.length) {
      const batch: ContentBlock[] = [];
      let bytes = 0;
      for (const block of job.blocks.slice(job.next, job.next + 40)) {
        const size = new TextEncoder().encode(JSON.stringify(block)).length;
        if (size > 350_000)
          throw new Error('A content block is too large to save. Use link-only mode.');
        if (bytes + size > 350_000) break;
        batch.push(block);
        bytes += size;
      }
      job.status = 'writing';
      job.inFlight = { start: job.next, count: batch.length };
      delete job.error;
      await persist();
      await client.append(job.pageId!, batch);
      job.next += batch.length;
      delete job.inFlight;
      await persist();
    }
    job.status = 'done';
    delete job.error;
    await persist();
  } catch (error) {
    const rejected =
      error instanceof NotionError && [400, 401, 403, 404, 429].includes(error.status);
    job.status = !job.pageId && job.status === 'creating' && !rejected ? 'uncertain' : 'paused';
    job.error = error instanceof Error ? error.message : 'Could not save. Please try again.';
    await persist();
  }
}

// Resume an uncertain creation only after its destination and existing content match the clip.
export async function attachPage(
  job: Job,
  id: string,
  client: Pick<Writer, 'children'> & {
    pageParent: (id: string) => Promise<{ kind: string; id: string }>;
  },
) {
  if (!validId(id) || job.status !== 'uncertain' || job.pageId)
    throw new Error('This clip cannot be attached to that page.');
  const parent = await client.pageParent(id);
  if (
    parent.kind !== `${job.destination.kind}_id` ||
    parent.id.replaceAll('-', '') !== job.destination.id.replaceAll('-', '')
  )
    throw new Error('This page is in a different destination.');
  const probe = { ...job, pageId: id };
  await reconcile(probe, client);
  job.pageId = id;
  job.pageUrl = `https://www.notion.so/${id.replaceAll('-', '')}`;
  job.next = probe.next;
  job.status = 'paused';
  delete job.inFlight;
  delete job.error;
}
