import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLocalData, migrateLegacy, writeLocalData } from '../src/storage.ts';
import { seal } from '../src/vault.ts';
import type { VaultData } from '../src/model.ts';
const saved: VaultData = {connections:[{id:'personal',name:'Personal',token:'ntn_fixture_token'}],jobs:[],recent:{},activeConnectionId:'personal'};
function storage(initial: Record<string,unknown> = {}) {
  const values = structuredClone(initial);
  return {values,get:async (key:string) => ({[key]:values[key]}),set:async (record:Record<string,unknown>) => {Object.assign(values,structuredClone(record));},remove:async (key:string) => {delete values[key];}};
}
test('new and returning connections load without a passphrase',async () => {
  const local = storage();
  assert.deepEqual((await readLocalData(local)).data?.connections,[]);
  await writeLocalData(local,saved);
  assert.deepEqual((await readLocalData(local)).data,saved);
});
test('migrates an existing encrypted vault once while preserving all workspace data',async () => {
  const local = storage({vault:await seal(saved,'old passphrase')});
  assert.equal((await readLocalData(local)).needsMigration,true);
  await assert.rejects(migrateLegacy(local,'wrong'),/unlock/i);
  assert.ok(local.values.vault);
  assert.equal(local.values.clipperData,undefined);
  await migrateLegacy(local,'old passphrase');
  assert.equal(local.values.vault,undefined);
  assert.deepEqual((await readLocalData(local)).data,saved);
  assert.equal((await readLocalData(local)).needsMigration,false);
});
test('automatically migrates a legacy empty passphrase without prompting',async () => {
  const local = storage({vault:await seal(saved,'')});
  assert.deepEqual((await readLocalData(local)).data,saved);
  assert.equal(local.values.vault,undefined);
});
