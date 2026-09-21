import { createHash, randomUUID } from 'node:crypto';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { NodeExport } from '../../engine/src/hub/node.ts';
import type { ReturnTypeMemberRuntime } from './runtime.ts';
import { records } from './records.ts';
import type { MemberRecoveryMove } from './member-recovery.ts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const b64 = /^[A-Za-z0-9_-]+$/;
type PrivateRecord = { id: string; revision: number; updatedAt: number; envelope: { profile: 'atarasy.private-node-record.1'; nonce: string; ciphertext: string } };
type Move = { id: string; household: string; sourceOrigin: string; targetOrigin: string; digest: string; state: 'prepared' | 'retired'; createdAt: number; retiredAt: number | null; receiptDigest: string | null };
type Imported = { digest: string; household: string; sourceOrigin: string; targetOrigin: string; move: string; importedAt: number; nodeDigest: string; privateRecords: number };
type Preparation = { id: string; move: string; household: string; credential: string; challenge: string; receiptDigest: string; expiresAt: number };
type ImportPreparation = { id: string; archiveDigest: string; household: string; credential: string; challenge: string; expiresAt: number };

export type MemberHostArchive = { profile: 'atarasy.member-host-archive.1'; move: string; household: string; sourceOrigin: string; targetOrigin: string; exportedAt: number; node: NodeExport; privateRecords: PrivateRecord[]; recovery: MemberRecoveryMove };
export type MemberHostImportReceipt = { profile: 'atarasy.member-host-import-receipt.1'; move: string; household: string; sourceOrigin: string; targetOrigin: string; archiveDigest: string; nodeDigest: string; privateRecords: number; importedAt: number };
export type MemberHostImportAttestation = { profile: 'atarasy.member-host-import-attestation.1'; receipt: MemberHostImportReceipt; proof: { credential: string; assertion: AuthenticationResponseJSON } };

export class MemberHostMoveError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
const fail = (status: number, code: string): never => { throw new MemberHostMoveError(status, code); };
const exact = (value: unknown, keys: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail(400, 'invalid_host_move');
  return value as Record<string, unknown>;
};
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('base64url');
const origin = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 2048) fail(400, 'invalid_host_move');
  const fixed = value as string;
  let url: URL; try { url = new URL(fixed); } catch { return fail(400, 'invalid_host_move'); }
  if (url.origin !== fixed || url.protocol !== 'https:' || url.username || url.password || url.hash || url.pathname !== '/' || url.search) fail(400, 'invalid_host_move');
  return fixed;
};
function response(value: unknown): AuthenticationResponseJSON {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 16_384) fail(400, 'invalid_host_move');
  return structuredClone(value) as AuthenticationResponseJSON;
}
function decodeArchive(encoded: unknown, suppliedDigest: unknown): { archive: MemberHostArchive; digest: string } {
  if (typeof encoded !== 'string' || !b64.test(encoded) || encoded.length % 4 === 1 || encoded.length > 8_000_000 || typeof suppliedDigest !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(suppliedDigest)) fail(400, 'invalid_host_move');
  const fixedEncoded = encoded as string, fixedDigest = suppliedDigest as string, bytes = Buffer.from(fixedEncoded, 'base64url');
  if (bytes.toString('base64url') !== fixedEncoded || digest(bytes) !== fixedDigest) fail(400, 'invalid_host_move');
  let value: unknown; try { value = JSON.parse(bytes.toString('utf8')); } catch { return fail(400, 'invalid_host_move'); }
  const object = exact(value, ['profile', 'move', 'household', 'sourceOrigin', 'targetOrigin', 'exportedAt', 'node', 'privateRecords', 'recovery']);
  if (object.profile !== 'atarasy.member-host-archive.1' || typeof object.move !== 'string' || !uuid.test(object.move) || typeof object.household !== 'string' || typeof object.exportedAt !== 'number' || !Number.isSafeInteger(object.exportedAt) || object.exportedAt < 0 || !Array.isArray(object.privateRecords) || object.privateRecords.length > 10_000 || !object.node || typeof object.node !== 'object' || !object.recovery || typeof object.recovery !== 'object') fail(400, 'invalid_host_move');
  origin(object.sourceOrigin); origin(object.targetOrigin);
  return { archive: value as MemberHostArchive, digest: fixedDigest };
}
function receipt(value: unknown): MemberHostImportReceipt {
  const row = exact(value, ['profile', 'move', 'household', 'sourceOrigin', 'targetOrigin', 'archiveDigest', 'nodeDigest', 'privateRecords', 'importedAt']);
  if (row.profile !== 'atarasy.member-host-import-receipt.1' || typeof row.move !== 'string' || !uuid.test(row.move) || typeof row.household !== 'string' || typeof row.archiveDigest !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(row.archiveDigest) || typeof row.nodeDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.nodeDigest) || typeof row.privateRecords !== 'number' || !Number.isSafeInteger(row.privateRecords) || row.privateRecords < 0 || row.privateRecords > 10_000 || typeof row.importedAt !== 'number' || !Number.isSafeInteger(row.importedAt) || row.importedAt < 0) fail(400, 'invalid_host_move');
  origin(row.sourceOrigin); origin(row.targetOrigin);
  return structuredClone(value) as MemberHostImportReceipt;
}
function importChallenge(value: MemberHostImportReceipt) { return digest(JSON.stringify(['atarasy.member-host-import-attestation.1', value])); }
function attestation(value: unknown): MemberHostImportAttestation {
  const row = exact(value, ['profile', 'receipt', 'proof']), proof = exact(row.proof, ['credential', 'assertion']);
  if (row.profile !== 'atarasy.member-host-import-attestation.1' || typeof proof.credential !== 'string' || !b64.test(proof.credential)) fail(400, 'invalid_host_move');
  const credential = proof.credential as string;
  return { profile: 'atarasy.member-host-import-attestation.1', receipt: receipt(row.receipt), proof: { credential, assertion: response(proof.assertion) } };
}

export function openMemberHostMove(r: ReturnTypeMemberRuntime, policy: { origin: string; rpID: string; maximumLifetimeMs: number }) {
  const moves = records<Move>(r.path, 'member_host_moves'), imports = records<Imported>(r.path, 'member_host_imports'), preparations = records<Preparation>(r.path, 'member_host_move_preparations'), importPreparations = records<ImportPreparation>(r.path, 'member_host_import_preparations');
  const now = r.now;
  function session(token: string): NonNullable<ReturnType<typeof r.authority.sessionPrincipal>> { const value = r.authority.sessionPrincipal(token); if (!value) fail(404, 'host_move_unavailable'); return value!; }
  function challenge(move: Move, receiptDigest: string) { return digest(JSON.stringify(['atarasy.member-host-retirement.1', move.id, move.household, move.sourceOrigin, move.targetOrigin, move.digest, receiptDigest])); }
  function options(who: ReturnType<typeof session>, move: Move, receiptDigest: string) {
    const at = now(), expiresAt = at + policy.maximumLifetimeMs, id = randomUUID(), value = challenge(move, receiptDigest);
    preparations.deleteWhere(row => row.expiresAt <= at);
    preparations.insert(id, { id, move: move.id, household: who.household, credential: who.credential, challenge: value, receiptDigest, expiresAt });
    return { id, expiresAt, publicKey: { challenge: value, rpId: policy.rpID, timeout: policy.maximumLifetimeMs, userVerification: 'required' as const, allowCredentials: [{ type: 'public-key' as const, id: who.credential }] } };
  }
  function importStatus(token: string, archiveDigest: string): MemberHostImportReceipt {
    const who = session(token), value = imports.get(archiveDigest);
    if (!value || value.household !== who.household) fail(404, 'host_move_unavailable');
    const fixed = value!;
    return { profile: 'atarasy.member-host-import-receipt.1', move: fixed.move, household: fixed.household, sourceOrigin: fixed.sourceOrigin, targetOrigin: fixed.targetOrigin, archiveDigest: fixed.digest, nodeDigest: fixed.nodeDigest, privateRecords: fixed.privateRecords, importedAt: fixed.importedAt };
  }
  return {
    prepareExport(token: string, target: unknown, node: NodeExport, privateRecords: PrivateRecord[], recovery: MemberRecoveryMove) {
      const who = session(token), targetOrigin = origin(target);
      if (targetOrigin === policy.origin || node.household !== who.household || !Array.isArray(privateRecords)) fail(400, 'invalid_host_move');
      const id = randomUUID(), archive: MemberHostArchive = { profile: 'atarasy.member-host-archive.1', move: id, household: who.household, sourceOrigin: policy.origin, targetOrigin, exportedAt: now(), node, privateRecords, recovery };
      const bytes = Buffer.from(JSON.stringify(archive)), archiveDigest = digest(bytes), row: Move = { id, household: who.household, sourceOrigin: policy.origin, targetOrigin, digest: archiveDigest, state: 'prepared', createdAt: archive.exportedAt, retiredAt: null, receiptDigest: null };
      moves.insert(id, row);
      return { profile: 'atarasy.member-host-export.1' as const, id, household: who.household, sourceOrigin: policy.origin, targetOrigin, digest: archiveDigest, archive: bytes.toString('base64url'), createdAt: archive.exportedAt };
    },
    inspectArchive(token: string, encoded: unknown, suppliedDigest: unknown) {
      const who = session(token), decoded = decodeArchive(encoded, suppliedDigest);
      if (decoded.archive.household !== who.household || decoded.archive.targetOrigin !== policy.origin || decoded.archive.sourceOrigin === policy.origin) fail(404, 'host_move_unavailable');
      return decoded;
    },
    imported(token: string, archive: MemberHostArchive, archiveDigest: string, nodeDigest: string, privateRecords: number): MemberHostImportReceipt {
      const who = session(token);
      if (who.household !== archive.household || archive.targetOrigin !== policy.origin || !/^[a-f0-9]{64}$/.test(nodeDigest) || !Number.isSafeInteger(privateRecords) || privateRecords < 0 || privateRecords > 10_000) fail(404, 'host_move_unavailable');
      const old = imports.get(archiveDigest), created: Imported = { digest: archiveDigest, household: who.household, sourceOrigin: archive.sourceOrigin, targetOrigin: policy.origin, move: archive.move, importedAt: now(), nodeDigest, privateRecords }, value: Imported = old === null ? created : old;
      if (old && JSON.stringify({ ...old, importedAt: 0 }) !== JSON.stringify({ ...value, importedAt: 0 })) fail(409, 'host_move_conflict');
      if (!old) imports.insert(archiveDigest, value);
      return { profile: 'atarasy.member-host-import-receipt.1', move: value.move, household: value.household, sourceOrigin: value.sourceOrigin, targetOrigin: value.targetOrigin, archiveDigest: value.digest, nodeDigest: value.nodeDigest, privateRecords: value.privateRecords, importedAt: value.importedAt };
    },
    importStatus(token: string, archiveDigest: string) {
      return importStatus(token, archiveDigest);
    },
    prepareImportAttestation(token: string, archiveDigest: string) {
      const who = session(token), imported = importStatus(token, archiveDigest), at = now(), expiresAt = at + policy.maximumLifetimeMs, id = randomUUID(), value = importChallenge(imported);
      importPreparations.deleteWhere(row => row.expiresAt <= at);
      importPreparations.insert(id, { id, archiveDigest, household: who.household, credential: who.credential, challenge: value, expiresAt });
      return { profile: 'atarasy.member-host-import-attestation-review.1' as const, receipt: imported, id, expiresAt, publicKey: { challenge: value, rpId: policy.rpID, timeout: policy.maximumLifetimeMs, userVerification: 'required' as const, allowCredentials: [{ type: 'public-key' as const, id: who.credential }] } };
    },
    async attestImport(token: string, archiveDigest: string, value: unknown): Promise<MemberHostImportAttestation> {
      const who = session(token), body = exact(value, ['assertion', 'preparation']), imported = importStatus(token, archiveDigest), prepared = typeof body.preparation === 'string' ? importPreparations.get(body.preparation) : null, expected = importChallenge(imported);
      if (!prepared || prepared.archiveDigest !== archiveDigest || prepared.household !== who.household || prepared.credential !== who.credential || prepared.challenge !== expected || prepared.expiresAt <= now()) fail(404, 'host_move_unavailable');
      const fixedPrepared = prepared!;
      await r.login.verifyPreparedAssertion(who.credential, expected, response(body.assertion));
      importPreparations.delete(fixedPrepared.id);
      return { profile: 'atarasy.member-host-import-attestation.1', receipt: imported, proof: { credential: who.credential, assertion: response(body.assertion) } };
    },
    async prepareRetirement(token: string, id: string, suppliedAttestation: unknown) {
      const who = session(token), move = moves.get(id), attested = attestation(suppliedAttestation), imported = attested.receipt, receiptDigest = digest(JSON.stringify(attested));
      if (!move || move.household !== who.household || move.state !== 'prepared' || imported.move !== move.id || imported.household !== move.household || imported.sourceOrigin !== move.sourceOrigin || imported.targetOrigin !== move.targetOrigin || imported.archiveDigest !== move.digest) fail(404, 'host_move_unavailable');
      if (attested.proof.credential !== who.credential) fail(404, 'host_move_unavailable');
      const fixed = move!;
      try { await r.login.verifyPortableAssertion(who.credential, importChallenge(imported), attested.proof.assertion, fixed.targetOrigin); } catch { fail(404, 'host_move_unavailable'); }
      return { profile: 'atarasy.member-host-retirement-review.1' as const, move: structuredClone(fixed), attestation: attested, receiptDigest, ...options(who, fixed, receiptDigest) };
    },
    async retire(token: string, id: string, value: unknown) {
      const who = session(token), body = exact(value, ['assertion', 'attestation', 'preparation']), move = moves.get(id), attested = attestation(body.attestation), imported = attested.receipt, receiptDigest = digest(JSON.stringify(attested));
      if (!move || move.household !== who.household || move.state !== 'prepared' || imported.move !== move.id || imported.household !== move.household || imported.sourceOrigin !== move.sourceOrigin || imported.targetOrigin !== move.targetOrigin || imported.archiveDigest !== move.digest || typeof body.preparation !== 'string') fail(404, 'host_move_unavailable');
      const fixed = move!, preparationID = body.preparation as string, prepared = preparations.get(preparationID);
      if (!prepared || prepared.move !== fixed.id || prepared.household !== who.household || prepared.credential !== who.credential || prepared.challenge !== challenge(fixed, receiptDigest) || prepared.receiptDigest !== receiptDigest || prepared.expiresAt <= now()) fail(404, 'host_move_unavailable');
      const fixedPrepared = prepared!;
      await r.login.verifyPreparedAssertion(who.credential, fixedPrepared.challenge, response(body.assertion));
      preparations.delete(fixedPrepared.id); const at = now(); moves.put(id, { ...fixed, state: 'retired', retiredAt: at, receiptDigest });
      r.authority.retireHouseholdAccess(token);
      return { profile: 'atarasy.member-host-retirement.1' as const, move: id, household: who.household, targetOrigin: fixed.targetOrigin, archiveDigest: fixed.digest, receiptDigest, retiredAt: at };
    },
  };
}
