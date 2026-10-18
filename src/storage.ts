import type { Encrypted, VaultData } from './model';
import { unseal } from './vault';
interface Storage {
  get: (key: string) => Promise<Record<string,unknown>>;
  set: (record: Record<string,unknown>) => Promise<unknown>;
  remove: (key: string) => Promise<unknown>;
}
const empty = (): VaultData => ({connections:[],jobs:[],recent:{}});
function validate(value: unknown): VaultData {
  const data = value as VaultData;
  if (!data || !Array.isArray(data.connections) || !Array.isArray(data.jobs) || !data.recent) throw new Error('The saved clipper data is invalid.');
  return data;
}
export async function writeLocalData(storage: Storage,data: VaultData) {
  await storage.set({clipperData:{version:2,data}});
}
export async function migrateLegacy(storage: Storage,passphrase: string): Promise<VaultData> {
  const legacy = (await storage.get('vault')).vault as Encrypted | undefined;
  if (!legacy) throw new Error('There is no encrypted data to migrate.');
  const data = validate(await unseal(legacy,passphrase));
  // Save the replacement before removing legacy data, so a failed write loses nothing.
  await writeLocalData(storage,data);
  await storage.remove('vault');
  return data;
}
export async function readLocalData(storage: Storage): Promise<{data?:VaultData;needsMigration:boolean}> {
  const current = (await storage.get('clipperData')).clipperData as {version:number;data:unknown} | undefined;
  if (current) {
    if (current.version !== 2) throw new Error('This saved data needs a newer clipper version.');
    return {data:validate(current.data),needsMigration:false};
  }
  const legacy = (await storage.get('vault')).vault;
  if (!legacy) return {data:empty(),needsMigration:false};
  try { return {data:await migrateLegacy(storage,''),needsMigration:false}; }
  catch { return {needsMigration:true}; }
}
