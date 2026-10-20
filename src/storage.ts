import type { LocalData, SavedClip, Clip } from './model';

interface Storage {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (record: Record<string, unknown>) => Promise<unknown>;
}

export function emptyLocalData(): LocalData {
  return { connections: [], jobs: [], recent: {} };
}

// Keep five completed title/link summaries while preserving unfinished captures for recovery.
export async function writeLocalData(storage: Storage, data: LocalData) {
  let completed = 0;
  data.jobs = data.jobs.flatMap<Clip>((job) => {
    if (job.status !== 'done') return [job];
    if (++completed > 5) return [];
    const summary: SavedClip = {
      id: job.id,
      status: 'done',
      title: job.title,
      source: job.source,
      ...(job.pageUrl ? { pageUrl: job.pageUrl } : {}),
    };
    return [summary];
  });
  await storage.set({ clipperData: { version: 2, data } });
}

// Validate persisted data before exposing it to the background handlers.
export async function readLocalData(storage: Storage): Promise<LocalData> {
  const current = (await storage.get('clipperData')).clipperData as
    { version: number; data: LocalData } | undefined;

  if (!current) return emptyLocalData();
  if (current.version !== 2) {
    throw new Error('This saved data needs a newer clipper version.');
  }

  const { data } = current;
  if (!data || !Array.isArray(data.connections) || !Array.isArray(data.jobs) || !data.recent) {
    throw new Error('The saved clipper data is invalid.');
  }

  // Apply the same retention policy when reopening previously saved history.
  await writeLocalData(storage, data);
  return data;
}
