// Generated fixture only: no bearer, private key or assertion is exported.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedUnified, unifiedRuntime, loginResponse } from './unified-fixture.ts';
import { openAtomicStore } from './atomic-store.ts';
import { atomicScope } from './atomic-fixture.ts';
import { openStatementAuthorisations } from './statement-authorisation.ts';
const directory = mkdtempSync(join(tmpdir(), 'swift-operation-'));
try {
 const path = join(directory, 'db.sqlite'), fixture = await seedUnified(path), unit = openAtomicStore(path, atomicScope);
 await unit.run((store, db) => unifiedRuntime(store, db).journal.cancel(fixture.input.token, fixture.input.operation.id)); unit.close();
 const api = openStatementAuthorisations(path, {environment:'test', origin:atomicScope.audience, rpID:'unit.example', maximumLifetimeMs:5000, maxSessionLifetimeMs:10000, now:()=>1_800_000_000_002, engine:{explorationRate:0.2,reminderLimit:1,recoveryGraceDays:3,relyingPartyId:'unit.example'}});
 try {
  const prepared = await api.prepare(fixture.input.token, {offer:fixture.input.statement.offer, disputed:[]});
  const pending = await api.outcome(fixture.input.token, prepared.operationID);
  const committed = await api.settle(fixture.input.token, prepared.operationID, loginResponse(fixture.pair, fixture.input.credential, fixture.user, prepared.publicKey.challenge, 2));
  process.stdout.write(JSON.stringify({prepared,pending,committed},null,2)+'\n');
 } finally { api.close(); }
} finally { rmSync(directory,{recursive:true,force:true}); }
