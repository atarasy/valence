import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemberAuthority } from '../member-read/authority.ts';
import { openVerifiedLogin } from './login.ts';
import { openEnrollment } from './enrollment.ts';
import { syntheticAuthenticator } from './fixtures/authenticator.ts';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'enrollment-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const state = { at: 1000 };
  const policy = { environment: 'test', origin: 'https://unit.example', rpID: 'unit.example', rpName: 'Atarasy test', invitationLifetimeMs: 2000, challengeLifetimeMs: 1000, sessionLifetimeMs: 4000, now: () => state.at };
  const authority = openMemberAuthority(join(dir,'authority.sqlite'), { environment: policy.environment, audience: policy.origin, maxSessionLifetimeMs: 5000, now: policy.now }); cleanups.push(() => authority.close());
  authority.provisionPrincipal('member','household',['presenter']);
  const connectLogin = () => { const login = openVerifiedLogin(join(dir,'login.sqlite'),authority,policy); cleanups.push(() => login.close()); return login; };
  const login = connectLogin();
  const connect = () => { const enrollment = openEnrollment(join(dir,'enrollment.sqlite'),authority,login,policy); cleanups.push(() => enrollment.close()); return enrollment; };
  const enrollment = connect();
  return { dir, state, policy, authority, login, enrollment, connect, connectLogin };
}

test('verified registration followed by signed login binds only the invited principal', async () => {
  const { enrollment, login, authority, policy } = setup(); const key = syntheticAuthenticator();
  const invite = enrollment.issueInvitation('member'), flow = await enrollment.begin(invite.token);
  expect(flow.publicKey.authenticatorSelection!.residentKey).toBe('required'); expect(flow.publicKey.pubKeyCredParams).toEqual([{type:'public-key',alg:-7}]);
  expect(await enrollment.finish(flow.id,key.register(flow.publicKey.challenge,policy.origin,policy.rpID))).toEqual({registered:true});
  const challenge = login.begin(); const session = await login.finish(challenge.id,key.authenticate(challenge.publicKey.challenge,policy.origin,policy.rpID,flow.publicKey.user.id));
  expect((await authority.resolveSession(session.token))!.household).toBe('household');
  expect(() => enrollment.issueInvitation('unprovisioned')).toThrow();
});

test('wrong challenge, origin, RP, type, flags and credential substitution consume registration attempts', async () => {
  const { enrollment, policy } = setup();
  for (const wrong of ['challenge','origin','rp','type','presence','verification','id']) {
    const key = syntheticAuthenticator(), invite = enrollment.issueInvitation('member'), flow = await enrollment.begin(invite.token);
    const response = key.register(wrong==='challenge'?'wrong':flow.publicKey.challenge, wrong==='origin'?'https://other.example':policy.origin, wrong==='rp'?'other.example':policy.rpID, {type:wrong==='type'?'webauthn.get':undefined,flags:wrong==='presence'?0x44:wrong==='verification'?0x41:undefined,id:wrong==='id'?'Zm9yZ2Vk':undefined});
    await expect(enrollment.finish(flow.id,response)).rejects.toThrow();
    await expect(enrollment.finish(flow.id,key.register(flow.publicKey.challenge,policy.origin,policy.rpID))).rejects.toThrow();
  }
});

test('invitation redemption and registration cannot race or replay across connections', async () => {
  const { enrollment, connect, policy } = setup(); const peer=connect(), invitation=enrollment.issueInvitation('member');
  const attempts=await Promise.allSettled([enrollment.begin(invitation.token),peer.begin(invitation.token)]);
  expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const flow=(attempts.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof enrollment.begin>>>).value;
  const key=syntheticAuthenticator(),response=key.register(flow.publicKey.challenge,policy.origin,policy.rpID);
  const finishes=await Promise.allSettled([enrollment.finish(flow.id,response),peer.finish(flow.id,response)]);
  expect(finishes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  await expect(enrollment.begin(invitation.token)).rejects.toThrow();
});

test('expiry and principal disablement prevent enrollment even while verification awaits', async () => {
  for (const action of ['invitation','flow','disabled','during'] as const) {
    const { enrollment,authority,state,policy }=setup();const invitation=enrollment.issueInvitation('member');
    if(action==='invitation'){state.at=invitation.expiresAt;await expect(enrollment.begin(invitation.token)).rejects.toThrow();continue;}
    const flow=await enrollment.begin(invitation.token),key=syntheticAuthenticator();
    if(action==='flow')state.at=flow.expiresAt;
    if(action==='disabled')authority.disablePrincipal('member');
    const pending=enrollment.finish(flow.id,key.register(flow.publicKey.challenge,policy.origin,policy.rpID));
    if(action==='during')authority.disablePrincipal('member');
    await expect(pending).rejects.toThrow();
  }
});

test('user handles and pending registration survive reopen; invitation secrets are not stored', async () => {
  const { enrollment,connect,dir,policy }=setup();const invite=enrollment.issueInvitation('member');
  for(const f of readdirSync(dir))expect(readFileSync(join(dir,f)).includes(Buffer.from(invite.token))).toBe(false);
  const flow=await enrollment.begin(invite.token);enrollment.close();const reopened=connect(),key=syntheticAuthenticator();
  await reopened.finish(flow.id,key.register(flow.publicKey.challenge,policy.origin,policy.rpID));
  const another=await reopened.begin(reopened.issueInvitation('member').token);expect(another.publicKey.user.id).toBe(flow.publicKey.user.id);
});

test('activation failure leaves a pending key unable to authenticate after authority registration', async () => {
  const { dir,enrollment,login,policy,connectLogin }=setup(); const key=syntheticAuthenticator(),flow=await enrollment.begin(enrollment.issueInvitation('member').token);
  const sql=new Database(join(dir,'login.sqlite'));cleanups.push(()=>sql.close());
  sql.run("CREATE TRIGGER activation_failure BEFORE UPDATE OF active ON passkeys BEGIN SELECT RAISE(ABORT, 'injected activation failure'); END");
  await expect(enrollment.finish(flow.id,key.register(flow.publicKey.challenge,policy.origin,policy.rpID))).rejects.toThrow();
  expect(sql.query('SELECT active FROM passkeys WHERE id=?').get(key.id)).toEqual({active:0});
  const registered=new Database(join(dir,'authority.sqlite'),{readonly:true});cleanups.push(()=>registered.close());expect(registered.query('SELECT principal FROM credentials WHERE id=?').get(key.id)).toEqual({principal:'member'});
  sql.run('DROP TRIGGER activation_failure');login.close();const reopened=connectLogin();const challenge=reopened.begin();
  await expect(reopened.finish(challenge.id,key.authenticate(challenge.publicKey.challenge,policy.origin,policy.rpID,flow.publicKey.user.id))).rejects.toThrow();
});

test('duplicate credential authority cannot attach a verified key to another principal', async () => {
  const { dir,enrollment,authority,login,policy }=setup();const key=syntheticAuthenticator();
  authority.provisionPrincipal('other','other-household',[]);authority.registerCredential(key.id,'other');
  const flow=await enrollment.begin(enrollment.issueInvitation('member').token);
  await expect(enrollment.finish(flow.id,key.register(flow.publicKey.challenge,policy.origin,policy.rpID))).rejects.toThrow();
  const pending=new Database(join(dir,'login.sqlite'));cleanups.push(()=>pending.close());expect(pending.query('SELECT active FROM passkeys WHERE id=?').get(key.id)).toEqual({active:0});
  const challenge=login.begin();await expect(login.finish(challenge.id,key.authenticate(challenge.publicKey.challenge,policy.origin,policy.rpID,flow.publicKey.user.id))).rejects.toThrow();
});

test('recognised login schema 1 migrates existing keys; mismatched scope remains refused', async () => {
  const { dir,authority,policy }=setup();const path=join(dir,'legacy.sqlite'),sql=new Database(path);const key=syntheticAuthenticator();
  sql.run('CREATE TABLE login_meta (scope TEXT NOT NULL); CREATE TABLE passkeys (id TEXT PRIMARY KEY,public_key BLOB NOT NULL,counter INTEGER NOT NULL,user_handle TEXT NOT NULL,revision INTEGER NOT NULL); CREATE TABLE challenges (id TEXT PRIMARY KEY,challenge TEXT NOT NULL,expires INTEGER NOT NULL)');
  sql.query('INSERT INTO login_meta VALUES (?)').run(JSON.stringify([1,policy.environment,policy.origin,policy.rpID]));
  const handle='aGFuZGxl';sql.query('INSERT INTO passkeys VALUES (?,?,?,?,0)').run(key.id,key.cose,0,handle);sql.close();authority.registerCredential(key.id,'member');
  const migrated=openVerifiedLogin(path,authority,policy);cleanups.push(()=>migrated.close());const flow=migrated.begin();
  expect((await migrated.finish(flow.id,key.authenticate(flow.publicKey.challenge,policy.origin,policy.rpID,handle))).token).toMatch(/^amr1_/);
  expect(()=>openVerifiedLogin(path,authority,{...policy,environment:'foreign'})).toThrow();
});
