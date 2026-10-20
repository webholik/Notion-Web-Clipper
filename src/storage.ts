import type { LocalData } from './model';

interface Storage {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (record: Record<string, unknown>) => Promise<unknown>;
}

export function emptyLocalData(): LocalData {
  return { connections: [], jobs: [], recent: {} };
}

export async function writeLocalData(storage: Storage, data: LocalData) {
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

  return data;
}
