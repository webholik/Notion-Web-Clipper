import { richText, safeUrl } from './shared';
import type { ContentBlock, Destination } from './model';

export const API_VERSION = '2026-03-11';
export const validId = (id: string) => /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(id);
export class NotionError extends Error {
  constructor(message: string, public status = 0, public retryAfter = 0) { super(message); }
}
export function sourceBlock(url: string): ContentBlock {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: [...richText('Source: '), ...richText(url, {}, url)] } };
}
export class NotionClient {
  constructor(private token: string, private fetcher: typeof fetch = fetch) {}
  // All requests stay on this fixed origin. No webpage URLs or cookies are fetched.
  // https://developers.notion.com/reference/intro
  private async request(path: string, method = 'GET', body?: unknown): Promise<any> {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.notion.com/v1/${path}`, {
        method, headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': API_VERSION, 'Content-Type': 'application/json' },
        credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30_000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { throw new NotionError('Connection interrupted. Check your connection before continuing.'); }
    if (!response.ok) {
      const wait = Math.max(1, Number(response.headers.get('Retry-After')) || 30);
      const messages: Record<number, string> = {
        400: 'Notion rejected this content or destination schema. Check the destination and try again.',
        401: 'This integration token is invalid or has been revoked. Update the workspace connection.',
        403: 'Allow Read, Insert and Update content for your Notion integration.',
        404: 'Destination not found. Share the page or database with your integration in Notion.',
        409: 'Notion reported a conflict. Check the saved page before continuing.',
        429: `Notion is busy. Wait ${wait} seconds before retrying.`
      };
      throw new NotionError(messages[response.status] ?? 'Notion could not confirm this request. Check the saved page before retrying.', response.status, response.status === 429 ? wait : 0);
    }
    try {
      const value = await response.json();
      if (!value || typeof value !== 'object') throw new Error();
      return value;
    } catch { throw new NotionError('Notion returned an unreadable response. Check the saved page before retrying.'); }
  }
  async verify(): Promise<string> {
    const user = await this.request('users/me');
    if (user.object !== 'user' || !validId(user.id)) throw new Error('Unexpected Notion connection response.');
    return String(user.bot?.workspace_name || user.name || 'My workspace').slice(0, 80);
  }
  async search(query: string, cursor?: string): Promise<{ items: Destination[]; cursor?: string }> {
    const result = await this.request('search', 'POST', { query: query.slice(0, 100), page_size: 50, ...(cursor ? { start_cursor: cursor } : {}) });
    if (!Array.isArray(result.results)) throw new Error('Notion returned an invalid destination list.');
    const items: Destination[] = [];
    for (const row of result.results) {
      if (!row || !validId(row.id) || row.archived || row.in_trash || !['page', 'data_source'].includes(row.object)) continue;
      const props = Object.values(row.properties ?? {}) as any[];
      const title = props.find(p => p?.type === 'title');
      const name = (row.object === 'data_source' ? row.title : title?.title) ?? [];
      const text = Array.isArray(name) ? name.map((t: any) => t.plain_text ?? t.text?.content ?? '').join('') : '';
      items.push({ id: row.id, name: String(text || 'Untitled').slice(0, 300), kind: row.object,
        titleProperty: row.object === 'page' ? 'title' : String(title?.id ?? 'title'),
        ...(row.object === 'data_source' && props.find(p => p?.type === 'url') ? { urlProperty: String(props.find(p => p?.type === 'url').id) } : {}) });
    }
    return { items, ...(result.has_more && typeof result.next_cursor === 'string' ? { cursor: result.next_cursor } : {}) };
  }
  async createPage(destination: Destination, title: string, source: string): Promise<{ id: string; url: string }> {
    if (!validId(destination.id) || !title.trim() || !safeUrl(source)) throw new Error('Invalid clipping destination, title or source URL.');
    let titleProperty = 'title';
    let urlProperty: string | undefined;
    if (destination.kind === 'data_source') {
      const schema = await this.request(`data_sources/${destination.id}`);
      const props = Object.values(schema.properties ?? {}) as any[];
      titleProperty = props.find(p => p?.type === 'title')?.id;
      urlProperty = props.find(p => p?.type === 'url')?.id;
      if (!titleProperty) throw new Error('This database has no writable title property. Choose another destination.');
    }
    // https://developers.notion.com/reference/post-page
    const result = await this.request('pages', 'POST', {
      parent: destination.kind === 'page' ? { type: 'page_id', page_id: destination.id } : { type: 'data_source_id', data_source_id: destination.id },
      properties: { [titleProperty]: { title: richText(title.trim().slice(0, 1000)) }, ...(urlProperty ? { [urlProperty]: { url: source } } : {}) },
      children: [sourceBlock(source)]
    });
    if (!validId(result.id) || !safeUrl(result.url)) throw new NotionError('Notion did not confirm the new page. Check Notion before retrying.');
    return { id: result.id, url: result.url };
  }
  async append(pageId: string, blocks: ContentBlock[]): Promise<void> {
    if (!validId(pageId) || blocks.length > 100) throw new Error('Invalid content batch.');
    await this.request(`blocks/${pageId}/children`, 'PATCH', { children: blocks });
  }
  async children(pageId: string): Promise<ContentBlock[]> {
    if (!validId(pageId)) throw new Error('Invalid Notion page ID.');
    const all: ContentBlock[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.request(`blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!Array.isArray(result.results)) throw new Error('Unable to read existing page content.');
      all.push(...result.results);
      cursor = result.has_more && typeof result.next_cursor === 'string' ? result.next_cursor : undefined;
      if (all.length > 2000) throw new Error('This page has too much content to resume safely.');
    } while (cursor);
    return all;
  }
  async pageParent(pageId: string): Promise<{ kind: string; id: string }> {
    const page = await this.request(`pages/${pageId}`);
    return { kind: page.parent?.type, id: page.parent?.page_id ?? page.parent?.data_source_id ?? '' };
  }
}
