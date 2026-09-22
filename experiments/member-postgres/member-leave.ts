import { randomUUID, createHash } from 'node:crypto';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { ReturnTypeMemberRuntime } from './runtime.ts';
import { records } from './records.ts';
import { owner as privateNodeOwner } from './private-node.ts';
import { leaveBlockers, leaveHost, type Blocker, type LeaveContext } from '../../engine/src/hub/leave.ts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

type Preparation = { id: string; household: string; credential: string; challenge: string; expiresAt: number };
type HostMove = { id: string; household: string; state: 'prepared' | 'retired' };
type HostMovePreparation = { id: string; household: string };
type HostImport = { digest: string; household: string };
type HostImportPreparation = { id: string; household: string; expiresAt: number };
type RecoveryKey = { household: string };
type RecoveryConfiguration = { owner: string; recoverer: string };
type RecoveryRequest = { id: string; owner: string; recoverer: string; state: 'pending' | 'approved' | 'completed' | 'cancelled' };
type RecoveryLog = { id: string; owner: string };
type RecoveryPreparation = { id: string; household: string; expiresAt: number };
type MandateChange = { id: string; mandate: { household: string }; state: 'pending' | 'effective' | 'cancelled' | 'stale' };
type PermissionRequest = { terms: { requestID: string; household: string; reviewExpiresAt: number }; state: 'pending' | 'granted' | 'cancelled' };
type RefreshSubscription = { household: string };
type PrivateNodeRow = { owner: string };

export class MemberLeaveError extends Error {
  constructor(readonly status: number, readonly code: string, readonly blockers?: Blocker[]) { super(code); }
}
function fail(status: number, code: string, blockers?: Blocker[]): never { throw new MemberLeaveError(status, code, blockers); }
function response(value: unknown): AuthenticationResponseJSON {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 16_384) fail(400, 'invalid_leave');
  return structuredClone(value) as AuthenticationResponseJSON;
}
function digest(values: readonly unknown[]) { return createHash('sha256').update(JSON.stringify(values)).digest('base64url'); }
/** `records().deleteWhere` reports nothing back, and every deletion below wants a count for `deleted`. */
function sweep<T extends object>(table: ReturnType<typeof records<T>>, predicate: (v: T) => boolean): number {
  let n = 0;
  table.deleteWhere(v => { if (predicate(v)) { n++; return true; } return false; });
  return n;
}

/**
 * §14.3. A household leaves a host, decided by the founder on 2026-09-22 and
 * implemented at the engine layer in `engine/src/hub/leave.ts`. This module is
 * the member-facing ceremony around it: a status read, a signed review, and a
 * submission that runs the engine's deletion and this deployment's own
 * member-side rows in the one Postgres transaction `http.ts` already opens
 * per request (`store.ts`).
 *
 * `ctx` is the same shape `exportNode` (`hub/node.ts`) is handed in `http.ts`,
 * built from the same registers over the same request-scoped `store`: an
 * export says what leaves with the node, this says what a household may not
 * leave while, and deletes what remains when it can.
 *
 * Every map opened here is opened for the first time this request: the maps
 * `memberRuntime` always opens (`member_principals` and its neighbours) are
 * reached instead through `r.authority`, `r.login`, `r.enrollment`,
 * `r.bindings`, `r.journal` and `r.reviews`, each extended in this change with
 * exactly the household-scoped deletion this ceremony needs, because a
 * PostgreSQL map may be opened only once per transaction (`store.ts`,
 * `used.has(namespace)`) and those six are already open by the time this
 * module runs.
 */
export function openMemberLeave(r: ReturnTypeMemberRuntime, ctx: LeaveContext, policy: { origin: string; rpID: string; maximumLifetimeMs: number }) {
  const preparations = records<Preparation>(r.path, 'member_leave_preparations');
  const hostMoves = records<HostMove>(r.path, 'member_host_moves');
  const hostMovePreparations = records<HostMovePreparation>(r.path, 'member_host_move_preparations');
  const hostImports = records<HostImport>(r.path, 'member_host_imports');
  const hostImportPreparations = records<HostImportPreparation>(r.path, 'member_host_import_preparations');
  const recoveryKeys = records<RecoveryKey>(r.path, 'member_recovery_keys');
  const recoveryConfigurations = records<RecoveryConfiguration>(r.path, 'member_recovery_configurations');
  const recoveryRequests = records<RecoveryRequest>(r.path, 'member_recovery_requests');
  const recoveryLogs = records<RecoveryLog>(r.path, 'member_recovery_logs');
  const recoveryPreparations = records<RecoveryPreparation>(r.path, 'member_recovery_preparations');
  const mandateChanges = records<MandateChange>(r.path, 'member_mandate_changes');
  const permissionRequests = records<PermissionRequest>(r.path, 'member_permission_requests');
  const refreshSubscriptions = records<RefreshSubscription>(r.path, 'member_refresh_subscriptions');
  const androidRefreshSubscriptions = records<RefreshSubscription>(r.path, 'member_android_refresh_subscriptions');
  const privateRecords = records<PrivateNodeRow>(r.path, 'private_node_records');
  const now = r.now;

  function session(token: string) {
    const value = r.authority.sessionPrincipal(token);
    if (!value) fail(404, 'leave_unavailable');
    return value!;
  }

  /**
   * §14.3's own blockers (an offer in progress, a role held for another
   * household, and the rest of `engine/src/hub/leave.ts`) plus this
   * deployment's own member-side ceremonies: a host move or import mid-
   * ceremony, an unexpired member operation not yet committed, a mandate
   * change, recovery ceremony or permission decision this household has not
   * yet finished. Every one is something the household can finish or cancel
   * and then try leaving again.
   */
  function blockersFor(household: string): Blocker[] {
    const at = now(), blockers: Blocker[] = [...leaveBlockers(ctx, household, at)];
    hostMoves.each(m => { if (m.household === household && m.state === 'prepared') blockers.push({ kind: 'host_move_pending', id: m.id }); });
    hostImportPreparations.each(p => { if (p.household === household && p.expiresAt > at) blockers.push({ kind: 'host_move_pending', id: p.id }); });
    const op = r.operations.find(v => v.household === household && ['prepared', 'dispatching', 'uncertain'].includes(v.state) && v.expiresAt > at);
    if (op) blockers.push({ kind: 'operation_pending', id: op.id });
    mandateChanges.each(c => { if (c.mandate.household === household && c.state === 'pending') blockers.push({ kind: 'mandate_change_pending', id: c.id }); });
    recoveryRequests.each(row => { if ((row.owner === household || row.recoverer === household) && ['pending', 'approved'].includes(row.state)) blockers.push({ kind: 'recovery_request_pending', id: row.id }); });
    recoveryPreparations.each(p => { if (p.household === household && p.expiresAt > at) blockers.push({ kind: 'recovery_request_pending', id: p.id }); });
    // §14.3: a role held for another household blocks, and this service's own
    // two-of-three recovery names its recoverer here, apart from the engine's.
    recoveryConfigurations.each(c => { if (c.recoverer === household && c.owner !== household) blockers.push({ kind: 'recoverer', id: c.owner }); });
    return blockers;
  }

  function reviewDigest(id: string, household: string, expiresAt: number) {
    return digest(['atarasy.member-leave.1', id, household, policy.origin, policy.rpID, expiresAt]);
  }

  return {
    status(token: string) {
      const who = session(token);
      return { profile: 'atarasy.member-leave-status.1' as const, household: who.household, blockers: blockersFor(who.household) };
    },
    prepare(token: string) {
      const who = session(token), blockers = blockersFor(who.household);
      if (blockers.length) fail(409, 'leave_blocked', blockers);
      const at = now(), expiresAt = at + policy.maximumLifetimeMs, id = randomUUID(), value = reviewDigest(id, who.household, expiresAt);
      preparations.deleteWhere(row => row.expiresAt <= at);
      preparations.insert(id, { id, household: who.household, credential: who.credential, challenge: value, expiresAt });
      return {
        profile: 'atarasy.member-leave.1' as const, id, household: who.household, origin: policy.origin, rpID: policy.rpID, expiresAt, digest: value,
        publicKey: { challenge: value, rpId: policy.rpID, timeout: policy.maximumLifetimeMs, userVerification: 'required' as const, allowCredentials: [{ type: 'public-key' as const, id: who.credential }] },
      };
    },
    async submit(token: string, value: unknown) {
      const who = session(token);
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'assertion,preparation') fail(400, 'invalid_leave');
      const body = value as { assertion: unknown; preparation: unknown };
      if (typeof body.preparation !== 'string' || !uuid.test(body.preparation)) fail(404, 'leave_unavailable');
      const prepared = preparations.get(body.preparation);
      if (!prepared || prepared.household !== who.household || prepared.credential !== who.credential || prepared.expiresAt <= now() || prepared.challenge !== reviewDigest(prepared.id, prepared.household, prepared.expiresAt)) fail(404, 'leave_unavailable');
      const fixedPrepared = prepared!;
      // Review digest unchanged, not expired, same principal/credential/household
      // are the checks just above; UV and the counter are `verifyPreparedAssertion`'s
      // own (login.ts).
      await r.login.verifyPreparedAssertion(who.credential, fixedPrepared.challenge, response(body.assertion));
      preparations.delete(fixedPrepared.id);
      // A blocker can have appeared since `prepare`. This whole request is one
      // Postgres transaction (`store.ts`): throwing here rolls back the passkey
      // counter bump the verification above just made, along with everything
      // else, so a refusal at this point truly writes nothing.
      const blockers = blockersFor(who.household);
      // Refused after the signature was verified: the review is spent and this
      // answer commits, so the same assertion cannot delete the account later
      // once the blocker clears (refutation pass, 2026-09-22, F4). Throwing
      // here rolled the review's deletion back with everything else.
      if (blockers.length) return { refused: blockers } as const;
      const leftAt = now(), household = who.household;
      const engineResult = leaveHost(ctx, household, leftAt);
      const deleted: Record<string, number> = { ...engineResult.deleted };
      const bump = (key: string, n: number) => { if (n) deleted[key] = (deleted[key] ?? 0) + n; };
      const authResult = r.authority.deleteHouseholdRecords(household);
      bump('principals', authResult.principals);
      bump('credentials', authResult.credentials);
      bump('sessions', authResult.sessions);
      bump('ownership', authResult.ownership);
      for (const credentialID of authResult.credentialIDs) r.login.removeEnrolledPasskey(credentialID);
      bump('passkeys', authResult.credentialIDs.length);
      for (const principalID of authResult.principalIDs) { r.enrollment.cancelEnrolment(principalID); r.enrollment.dropHandle(principalID); }
      bump('mandate_bindings', r.bindings.deleteHousehold(household));
      const journalResult = r.journal.deleteHousehold(household);
      bump('operations', journalResult.operations);
      bump('decision_heads', journalResult.decisionHeads);
      let reviewsDeleted = 0;
      for (const key of [...journalResult.offerIDs, ...journalResult.operationIDs]) if (r.reviews.get(key) !== null) { r.reviews.delete(key); reviewsDeleted++; }
      bump('reviews', reviewsDeleted);
      bump('host_moves', sweep(hostMoves, m => m.household === household));
      bump('host_move_preparations', sweep(hostMovePreparations, p => p.household === household));
      bump('host_imports', sweep(hostImports, m => m.household === household));
      bump('host_import_preparations', sweep(hostImportPreparations, p => p.household === household));
      bump('recovery_keys', sweep(recoveryKeys, k => k.household === household));
      bump('recovery_configurations', sweep(recoveryConfigurations, c => c.owner === household));
      bump('recovery_requests', sweep(recoveryRequests, row => row.owner === household));
      bump('recovery_logs', sweep(recoveryLogs, log => log.owner === household));
      bump('recovery_preparations', sweep(recoveryPreparations, p => p.household === household));
      bump('mandate_changes', sweep(mandateChanges, c => c.mandate.household === household));
      bump('permission_requests', sweep(permissionRequests, row => row.terms.household === household));
      bump('refresh_subscriptions', sweep(refreshSubscriptions, s => s.household === household));
      bump('android_refresh_subscriptions', sweep(androidRefreshSubscriptions, s => s.household === household));
      const expectedOwner = privateNodeOwner(household);
      bump('private_node_records', sweep(privateRecords, row => row.owner === expectedOwner));
      return { profile: 'atarasy.member-left.1' as const, household, leftAt, deleted };
    },
  };
}
