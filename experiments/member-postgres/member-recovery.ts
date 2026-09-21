import { createHash, randomUUID } from 'node:crypto';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { isHouseholdName } from '../../engine/src/common/names.ts';
import type { ReturnTypeMemberRuntime } from './runtime.ts';
import { records } from './records.ts';

const b64 = /^[A-Za-z0-9_-]+$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
type State = 'pending' | 'approved' | 'completed' | 'cancelled';
type RecoveryKey = { household: string; publicKey: string; updatedAt: number };
type Configuration = { owner: string; recoverer: string; recovererKeyDigest: string; keyDigest: string; hostShare: string; recovererPacket: string; noticeChannel: string; epoch: number; createdAt: number; updatedAt: number };
type RecoveryRequest = { id: string; owner: string; recoverer: string; epoch: number; requesterPublicKey: string; hostShare: string; recovererPacket: string; keyDigest: string; noticeChannel: string; state: State; release: string | null; noticeID: string | null; noticeReceipt: string | null; createdAt: number; updatedAt: number };
type RecoveryLog = { id: string; owner: string; recovery: string; recoverer: string; state: 'notice_pending' | 'completed'; occurredAt: number; deliveredAt: number | null; receipt: string | null };
type Preparation = { id: string; household: string; credential: string; kind: 'key' | 'configuration' | 'approval'; challenge: string; expiresAt: number };
export type MemberRecoveryMove = { profile: 'atarasy.member-recovery-move.1'; keys: RecoveryKey[]; configurations: Configuration[]; requests: RecoveryRequest[]; logs: RecoveryLog[] };

export type MemberRecoveryNotice = { profile: 'atarasy.member-recovery-notice.1'; id: string; owner: string; recovery: string; occurredAt: number };
export type MemberRecoveryNoticeJob = { channel: string; notice: MemberRecoveryNotice };
export interface MemberRecoveryNotifier { deliver(job: MemberRecoveryNoticeJob): Promise<{ receipt: string }> }

export class MemberRecoveryError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function fail(status: number, code: string): never { throw new MemberRecoveryError(status, code); }
function unavailable(): never { return fail(404, 'recovery_unavailable'); }
function invalid(): never { return fail(400, 'invalid_recovery'); }
function decode(value: unknown, minimum: number, maximum: number): Buffer {
  if (typeof value !== 'string' || !b64.test(value) || value.length % 4 === 1) invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || bytes.length < minimum || bytes.length > maximum) invalid();
  return bytes;
}
function time(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid recovery time'); }
function digest(values: readonly string[]) { return createHash('sha256').update(JSON.stringify(values)).digest('base64url'); }
function keyDigest(value: string) { return digest(['atarasy.member-recovery-key.1', value]); }
function challenge(kind: string, values: readonly string[]) { return digest([kind, ...values]); }
function response(value: unknown): AuthenticationResponseJSON {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 16_384) invalid();
  return structuredClone(value) as AuthenticationResponseJSON;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) invalid();
  return value as Record<string, unknown>;
}

export function openMemberRecovery(r: ReturnTypeMemberRuntime, policy: { rpID: string; maximumLifetimeMs: number }) {
  const keys = records<RecoveryKey>(r.path, 'member_recovery_keys');
  const configurations = records<Configuration>(r.path, 'member_recovery_configurations');
  const requests = records<RecoveryRequest>(r.path, 'member_recovery_requests');
  const logs = records<RecoveryLog>(r.path, 'member_recovery_logs');
  const preparations = records<Preparation>(r.path, 'member_recovery_preparations');
  const now = r.now;
  function session(token: string) {
    const value = r.authority.sessionPrincipal(token);
    if (!value) unavailable();
    return value;
  }
  function options(who: ReturnType<typeof session>, kind: Preparation['kind'], value: string) {
    const at = now(), expiresAt = at + policy.maximumLifetimeMs, id = randomUUID(); time(expiresAt);
    preparations.deleteWhere(row => row.expiresAt <= at);
    preparations.insert(id, { id, household: who.household, credential: who.credential, kind, challenge: value, expiresAt });
    return { id, expiresAt, publicKey: { challenge: value, rpId: policy.rpID, timeout: policy.maximumLifetimeMs, userVerification: 'required' as const, allowCredentials: [{ type: 'public-key' as const, id: who.credential }] } };
  }
  function prepared(who: ReturnType<typeof session>, id: unknown, kind: Preparation['kind'], expected: string) {
    if (typeof id !== 'string' || !uuid.test(id)) invalid();
    const row = preparations.get(id);
    if (!row || row.household !== who.household || row.credential !== who.credential || row.kind !== kind || row.challenge !== expected || row.expiresAt <= now()) unavailable();
    return row;
  }
  function publicKey(value: unknown) {
    const bytes = decode(value, 65, 65);
    if (bytes[0] !== 4) invalid();
    return value as string;
  }
  function checkedConfiguration(value: unknown, owner: string) {
    const body = exact(value, ['epoch', 'hostShare', 'keyDigest', 'noticeChannel', 'recoverer', 'recovererPacket']);
    if (typeof body.recoverer !== 'string' || !isHouseholdName(body.recoverer) || body.recoverer === owner || typeof body.keyDigest !== 'string' || decode(body.keyDigest, 32, 32).length !== 32 || typeof body.hostShare !== 'string' || decode(body.hostShare, 64, 64).length !== 64 || typeof body.recovererPacket !== 'string' || decode(body.recovererPacket, 96, 2048).length < 96 || typeof body.noticeChannel !== 'string' || !/^anc1_[A-Za-z0-9_-]{43}$/.test(body.noticeChannel) || typeof body.epoch !== 'number' || !Number.isSafeInteger(body.epoch) || body.epoch < 1) invalid();
    const recovererKey = keys.get(body.recoverer);
    if (!recovererKey) unavailable();
    const current = configurations.get(owner), expected = (current?.epoch ?? 0) + 1;
    if (body.epoch !== expected) fail(409, 'recovery_epoch_conflict');
    return { owner, recoverer: body.recoverer as string, recovererKeyDigest: keyDigest(recovererKey.publicKey), keyDigest: body.keyDigest as string, hostShare: body.hostShare as string, recovererPacket: body.recovererPacket as string, noticeChannel: body.noticeChannel as string, epoch: body.epoch as number };
  }
  function configurationBytes(value: ReturnType<typeof checkedConfiguration>) {
    return [value.owner, value.recoverer, value.recovererKeyDigest, value.keyDigest, value.hostShare, value.recovererPacket, value.noticeChannel, String(value.epoch)];
  }
  function findRequest(id: string) { if (!uuid.test(id)) unavailable(); const row = requests.get(id); if (!row) unavailable(); return row; }
  function requestView(row: RecoveryRequest, household: string) {
    const owner = row.owner === household, recoverer = row.recoverer === household;
    if (!owner && !recoverer) unavailable();
    return {
      profile: 'atarasy.member-recovery-request.1' as const,
      id: row.id, owner: row.owner, recoverer: row.recoverer, epoch: row.epoch, requesterPublicKey: row.requesterPublicKey,
      state: row.state, createdAt: row.createdAt, updatedAt: row.updatedAt,
      recovererPacket: recoverer ? row.recovererPacket : null,
      release: owner && row.state === 'completed' ? row.release : recoverer ? row.release : null,
      hostShare: owner && row.state === 'completed' ? row.hostShare : null,
      keyDigest: owner && row.state === 'completed' ? row.keyDigest : null,
    };
  }
  function moveSnapshot(value: unknown, household: string): MemberRecoveryMove {
    const body = exact(value, ['profile', 'keys', 'configurations', 'requests', 'logs']);
    if (body.profile !== 'atarasy.member-recovery-move.1' || !Array.isArray(body.keys) || !Array.isArray(body.configurations) || !Array.isArray(body.requests) || !Array.isArray(body.logs) || [body.keys, body.configurations, body.requests, body.logs].some(rows => rows.length > 10_000)) invalid();
    const whole = (value: unknown) => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); return value; };
    const house = (value: unknown) => { if (typeof value !== 'string' || !isHouseholdName(value)) invalid(); return value; };
    const bounded = (value: unknown, maximum = 256) => { if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) invalid(); return value; };
    const keyRows = body.keys.map(value => { const row = exact(value, ['household', 'publicKey', 'updatedAt']); return { household: house(row.household), publicKey: publicKey(row.publicKey), updatedAt: whole(row.updatedAt) }; });
    const configurationRows = body.configurations.map(value => { const row = exact(value, ['owner', 'recoverer', 'recovererKeyDigest', 'keyDigest', 'hostShare', 'recovererPacket', 'noticeChannel', 'epoch', 'createdAt', 'updatedAt']); const fixed: Configuration = { owner: house(row.owner), recoverer: house(row.recoverer), recovererKeyDigest: decode(row.recovererKeyDigest, 32, 32).toString('base64url'), keyDigest: decode(row.keyDigest, 32, 32).toString('base64url'), hostShare: decode(row.hostShare, 64, 64).toString('base64url'), recovererPacket: decode(row.recovererPacket, 96, 2048).toString('base64url'), noticeChannel: bounded(row.noticeChannel, 48), epoch: whole(row.epoch), createdAt: whole(row.createdAt), updatedAt: whole(row.updatedAt) }; if (fixed.owner !== household || fixed.recoverer === household || fixed.epoch < 1 || fixed.createdAt > fixed.updatedAt || !/^anc1_[A-Za-z0-9_-]{43}$/.test(fixed.noticeChannel)) invalid(); return fixed; });
    const requestRows = body.requests.map(value => { const row = exact(value, ['id', 'owner', 'recoverer', 'epoch', 'requesterPublicKey', 'hostShare', 'recovererPacket', 'keyDigest', 'noticeChannel', 'state', 'release', 'noticeID', 'noticeReceipt', 'createdAt', 'updatedAt']); const state = row.state; if (!['completed', 'cancelled'].includes(state as string)) fail(409, 'recovery_move_pending'); const fixed: RecoveryRequest = { id: bounded(row.id, 36), owner: house(row.owner), recoverer: house(row.recoverer), epoch: whole(row.epoch), requesterPublicKey: publicKey(row.requesterPublicKey), hostShare: decode(row.hostShare, 64, 64).toString('base64url'), recovererPacket: decode(row.recovererPacket, 96, 2048).toString('base64url'), keyDigest: decode(row.keyDigest, 32, 32).toString('base64url'), noticeChannel: bounded(row.noticeChannel, 48), state: state as State, release: row.release === null ? null : decode(row.release, 96, 2048).toString('base64url'), noticeID: row.noticeID === null ? null : bounded(row.noticeID, 36), noticeReceipt: row.noticeReceipt === null ? null : bounded(row.noticeReceipt), createdAt: whole(row.createdAt), updatedAt: whole(row.updatedAt) }; if (!uuid.test(fixed.id) || (fixed.noticeID !== null && !uuid.test(fixed.noticeID)) || (fixed.owner !== household && fixed.recoverer !== household) || fixed.owner === fixed.recoverer || fixed.epoch < 1 || fixed.createdAt > fixed.updatedAt || !/^anc1_[A-Za-z0-9_-]{43}$/.test(fixed.noticeChannel) || (fixed.state === 'completed' && (!fixed.release || !fixed.noticeID || !fixed.noticeReceipt))) invalid(); return fixed; });
    const logRows = body.logs.map(value => { const row = exact(value, ['id', 'owner', 'recovery', 'recoverer', 'state', 'occurredAt', 'deliveredAt', 'receipt']); if (!['notice_pending', 'completed'].includes(row.state as string)) invalid(); const fixed: RecoveryLog = { id: bounded(row.id, 36), owner: house(row.owner), recovery: bounded(row.recovery, 36), recoverer: house(row.recoverer), state: row.state as RecoveryLog['state'], occurredAt: whole(row.occurredAt), deliveredAt: row.deliveredAt === null ? null : whole(row.deliveredAt), receipt: row.receipt === null ? null : bounded(row.receipt) }; if (!uuid.test(fixed.id) || !uuid.test(fixed.recovery) || fixed.owner !== household || (fixed.state === 'completed' ? fixed.deliveredAt === null || !fixed.receipt : fixed.deliveredAt !== null || fixed.receipt !== null)) invalid(); return fixed; });
    for (const rows of [keyRows, configurationRows, requestRows, logRows]) { const ids = rows.map(row => 'household' in row ? row.household : 'owner' in row && !('id' in row) ? row.owner : (row as {id:string}).id); if (new Set(ids).size !== ids.length) invalid(); }
    const keyMap = new Map(keyRows.map(row => [row.household, row]));
    for (const row of configurationRows) { const recoverer = keyMap.get(row.recoverer); if (!recoverer || keyDigest(recoverer.publicKey) !== row.recovererKeyDigest) invalid(); }
    const requestMap = new Map(requestRows.map(row => [row.id, row]));
    for (const row of logRows) { const request = requestMap.get(row.recovery); if (!request || request.owner !== row.owner || request.recoverer !== row.recoverer || request.noticeID !== row.id) invalid(); }
    const logMap = new Map(logRows.map(row => [row.id, row]));
    for (const row of requestRows) { if (row.owner === household && row.state === 'completed') { const log = row.noticeID && logMap.get(row.noticeID); if (!log || log.recovery !== row.id || log.state !== 'completed' || log.receipt !== row.noticeReceipt) invalid(); } }
    return { profile: 'atarasy.member-recovery-move.1', keys: keyRows, configurations: configurationRows, requests: requestRows, logs: logRows };
  }
  return {
    exportForMove(token: string): MemberRecoveryMove {
      const who = session(token), keyHouseholds = new Set<string>([who.household]), configurationRows: Configuration[] = [], requestRows: RecoveryRequest[] = [], logRows: RecoveryLog[] = [];
      configurations.each(row => { if (row.owner === who.household) { configurationRows.push(row); keyHouseholds.add(row.recoverer); } });
      requests.each(row => { if (row.owner === who.household || row.recoverer === who.household) { if (row.state === 'pending' || row.state === 'approved') fail(409, 'recovery_move_pending'); requestRows.push(row); keyHouseholds.add(row.recoverer); } });
      logs.each(row => { if (row.owner === who.household) logRows.push(row); });
      const keyRows: RecoveryKey[] = []; keys.each(row => { if (keyHouseholds.has(row.household)) keyRows.push(row); });
      for (const rows of [keyRows, configurationRows, requestRows, logRows]) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return moveSnapshot({ profile: 'atarasy.member-recovery-move.1', keys: keyRows, configurations: configurationRows, requests: requestRows, logs: logRows }, who.household);
    },
    importForMove(token: string, value: unknown) {
      const who = session(token), snapshot = moveSnapshot(value, who.household);
      const configurationIDs = new Set(snapshot.configurations.map(row => row.owner)), requestIDs = new Set(snapshot.requests.map(row => row.id)), logIDs = new Set(snapshot.logs.map(row => row.id));
      configurations.each(row => { if (row.owner === who.household && !configurationIDs.has(row.owner)) fail(409, 'recovery_move_conflict'); });
      requests.each(row => { if ((row.owner === who.household || row.recoverer === who.household) && !requestIDs.has(row.id)) fail(409, 'recovery_move_conflict'); });
      logs.each(row => { if (row.owner === who.household && !logIDs.has(row.id)) fail(409, 'recovery_move_conflict'); });
      const accept = <T extends object>(table: ReturnType<typeof records<T>>, key: string, row: T) => { const held = table.get(key); if (held && JSON.stringify(held) !== JSON.stringify(row)) fail(409, 'recovery_move_conflict'); if (!held) table.insert(key, row); };
      for (const row of snapshot.keys) accept(keys, row.household, row);
      for (const row of snapshot.configurations) accept(configurations, row.owner, row);
      for (const row of snapshot.requests) accept(requests, row.id, row);
      for (const row of snapshot.logs) accept(logs, row.id, row);
      return snapshot;
    },
    recoveryKey(token: string) { const who = session(token), row = keys.get(who.household); return { profile: 'atarasy.member-recovery-key.1' as const, household: who.household, publicKey: row?.publicKey ?? null, updatedAt: row?.updatedAt ?? null }; },
    prepareRecoveryKey(token: string, value: unknown) {
      const who = session(token), key = publicKey(exact(value, ['publicKey']).publicKey), valueChallenge = challenge('atarasy.member-recovery-key-registration.1', [who.household, key]);
      return { profile: 'atarasy.member-recovery-key-registration.1' as const, household: who.household, recoveryPublicKey: key, ...options(who, 'key', valueChallenge) };
    },
    async registerRecoveryKey(token: string, value: unknown) {
      const who = session(token), body = exact(value, ['assertion', 'preparation', 'publicKey']), key = publicKey(body.publicKey), valueChallenge = challenge('atarasy.member-recovery-key-registration.1', [who.household, key]), preparation = prepared(who, body.preparation, 'key', valueChallenge);
      await r.login.verifyPreparedAssertion(who.credential, valueChallenge, response(body.assertion));
      preparations.delete(preparation.id);
      const current = keys.get(who.household);
      if (current && current.publicKey !== key) fail(409, 'recovery_key_exists');
      const row: RecoveryKey = current ?? { household: who.household, publicKey: key, updatedAt: now() };
      keys.put(who.household, row);
      return { profile: 'atarasy.member-recovery-key.1' as const, ...row };
    },
    participant(token: string, value: unknown) {
      session(token); const body = exact(value, ['household']);
      if (typeof body.household !== 'string' || !isHouseholdName(body.household)) invalid();
      const row = keys.get(body.household); if (!row) unavailable();
      return { profile: 'atarasy.member-recovery-participant.1' as const, household: row.household, publicKey: row.publicKey, keyDigest: keyDigest(row.publicKey), updatedAt: row.updatedAt };
    },
    configuration(token: string) {
      const who = session(token), row = configurations.get(who.household);
      return { profile: 'atarasy.member-recovery-configuration.1' as const, owner: who.household, configured: row !== null, recoverer: row?.recoverer ?? null, recovererKeyDigest: row?.recovererKeyDigest ?? null, keyDigest: row?.keyDigest ?? null, epoch: row?.epoch ?? null, createdAt: row?.createdAt ?? null, updatedAt: row?.updatedAt ?? null };
    },
    prepareConfiguration(token: string, value: unknown) {
      const who = session(token), fixed = checkedConfiguration(value, who.household), valueChallenge = challenge('atarasy.member-recovery-configuration.1', configurationBytes(fixed));
      return { profile: 'atarasy.member-recovery-configuration-review.1' as const, configuration: fixed, ...options(who, 'configuration', valueChallenge) };
    },
    async configure(token: string, value: unknown) {
      const who = session(token), body = exact(value, ['assertion', 'configuration', 'preparation']), fixed = checkedConfiguration(body.configuration, who.household), valueChallenge = challenge('atarasy.member-recovery-configuration.1', configurationBytes(fixed)), preparation = prepared(who, body.preparation, 'configuration', valueChallenge);
      await r.login.verifyPreparedAssertion(who.credential, valueChallenge, response(body.assertion));
      preparations.delete(preparation.id);
      const at = now(), old = configurations.get(who.household);
      const row: Configuration = { ...fixed, createdAt: old?.createdAt ?? at, updatedAt: at };
      configurations.put(who.household, row);
      requests.each(request => { if (request.owner === who.household && request.state !== 'completed' && request.state !== 'cancelled') requests.put(request.id, { ...request, state: 'cancelled', updatedAt: at }); });
      return { profile: 'atarasy.member-recovery-configuration.1' as const, owner: row.owner, configured: true, recoverer: row.recoverer, recovererKeyDigest: row.recovererKeyDigest, keyDigest: row.keyDigest, epoch: row.epoch, createdAt: row.createdAt, updatedAt: row.updatedAt };
    },
    createRequest(token: string, value: unknown) {
      const who = session(token), body = exact(value, ['requesterPublicKey']), requesterPublicKey = publicKey(body.requesterPublicKey), configuration = configurations.get(who.household);
      if (!configuration) unavailable();
      let existing: RecoveryRequest | null = null;
      requests.each(row => { if (row.owner === who.household && row.epoch === configuration.epoch && ['pending', 'approved'].includes(row.state)) existing = row; });
      if (existing) {
        if ((existing as RecoveryRequest).requesterPublicKey !== requesterPublicKey) fail(409, 'recovery_pending');
        return requestView(existing as RecoveryRequest, who.household);
      }
      const at = now(), row: RecoveryRequest = { id: randomUUID(), owner: who.household, recoverer: configuration.recoverer, epoch: configuration.epoch, requesterPublicKey, hostShare: configuration.hostShare, recovererPacket: configuration.recovererPacket, keyDigest: configuration.keyDigest, noticeChannel: configuration.noticeChannel, state: 'pending', release: null, noticeID: null, noticeReceipt: null, createdAt: at, updatedAt: at };
      requests.insert(row.id, row); return requestView(row, who.household);
    },
    listRequests(token: string) {
      const who = session(token), values: ReturnType<typeof requestView>[] = [];
      requests.each(row => { if (row.owner === who.household || row.recoverer === who.household) values.push(requestView(row, who.household)); });
      values.sort((a, b) => a.id.localeCompare(b.id)); return { profile: 'atarasy.member-recovery-request-list.1' as const, checkedAt: now(), requests: values };
    },
    readRequest(token: string, id: string) { const who = session(token); return requestView(findRequest(id), who.household); },
    prepareApproval(token: string, id: string, value: unknown) {
      const who = session(token), row = findRequest(id), body = exact(value, ['release']);
      if (row.recoverer !== who.household || row.state !== 'pending' || typeof body.release !== 'string' || decode(body.release, 96, 2048).length < 96) unavailable();
      const valueChallenge = challenge('atarasy.member-recovery-approval.1', [row.id, row.owner, row.recoverer, String(row.epoch), row.requesterPublicKey, body.release]);
      return { profile: 'atarasy.member-recovery-approval-review.1' as const, request: requestView(row, who.household), release: body.release, ...options(who, 'approval', valueChallenge) };
    },
    async approve(token: string, id: string, value: unknown) {
      const who = session(token), row = findRequest(id), body = exact(value, ['assertion', 'preparation', 'release']);
      if (row.recoverer !== who.household || typeof body.release !== 'string' || decode(body.release, 96, 2048).length < 96) unavailable();
      if (row.state !== 'pending') {
        if (['approved', 'completed'].includes(row.state) && row.release === body.release) return requestView(row, who.household);
        unavailable();
      }
      const valueChallenge = challenge('atarasy.member-recovery-approval.1', [row.id, row.owner, row.recoverer, String(row.epoch), row.requesterPublicKey, body.release]);
      const preparation = prepared(who, body.preparation, 'approval', valueChallenge);
      await r.login.verifyPreparedAssertion(who.credential, valueChallenge, response(body.assertion));
      preparations.delete(preparation.id);
      const at = now(), noticeID = randomUUID(), approved: RecoveryRequest = { ...row, state: 'approved', release: body.release, noticeID, updatedAt: at };
      requests.put(row.id, approved);
      logs.insert(noticeID, { id: noticeID, owner: row.owner, recovery: row.id, recoverer: row.recoverer, state: 'notice_pending', occurredAt: at, deliveredAt: null, receipt: null });
      return requestView(approved, who.household);
    },
    log(token: string) {
      const who = session(token), values: RecoveryLog[] = [];
      logs.each(row => { if (row.owner === who.household) values.push(structuredClone(row)); }); values.sort((a, b) => a.id.localeCompare(b.id));
      return { profile: 'atarasy.member-recovery-log.1' as const, owner: who.household, events: values };
    },
    pendingNotices(): MemberRecoveryNoticeJob[] {
      const jobs: MemberRecoveryNoticeJob[] = [];
      logs.each(log => { if (log.state === 'notice_pending') { const request = requests.get(log.recovery); if (request?.state === 'approved' && request.noticeID === log.id) jobs.push({ channel: request.noticeChannel, notice: { profile: 'atarasy.member-recovery-notice.1', id: log.id, owner: log.owner, recovery: log.recovery, occurredAt: log.occurredAt } }); } });
      return jobs.sort((a, b) => a.notice.id.localeCompare(b.notice.id));
    },
    acknowledgeNotice(id: string, receipt: string) {
      if (!uuid.test(id) || typeof receipt !== 'string' || !receipt || receipt.length > 256 || /[\u0000-\u001f\u007f]/.test(receipt)) throw new Error('Invalid recovery notice acknowledgement');
      const log = logs.get(id); if (!log) throw new Error('Recovery notice unavailable');
      const request = requests.get(log.recovery); if (!request || request.noticeID !== id || !request.release) throw new Error('Recovery request unavailable');
      if (log.state === 'completed') { if (log.receipt !== receipt) throw new Error('Recovery notice acknowledgement changed'); return; }
      if (log.state !== 'notice_pending' || request.state !== 'approved') throw new Error('Recovery notice unavailable');
      const at = now(); logs.put(id, { ...log, state: 'completed', deliveredAt: at, receipt }); requests.put(request.id, { ...request, state: 'completed', noticeReceipt: receipt, updatedAt: at });
    },
  };
}
