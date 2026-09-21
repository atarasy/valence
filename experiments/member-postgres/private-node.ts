import { createHash } from 'node:crypto';
import type { ReturnTypeMemberRuntime } from './runtime.ts';
import { records } from './records.ts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const base64url = /^[A-Za-z0-9_-]+$/;
const maximumRevision = 9_007_199_254_740_991;
// Base64 plus the fixed JSON envelope stays below the member HTTP profile's 20 KiB floor.
const maximumCiphertextBytes = 12_288;

type Envelope = { profile: 'atarasy.private-node-record.1'; nonce: string; ciphertext: string };
type Stored = Envelope & { owner: string; id: string; revision: number; updatedAt: number };

export class PrivateNodeError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

function unavailable(): never { throw new PrivateNodeError(404, 'private_record_unavailable'); }
function invalid(): never { throw new PrivateNodeError(400, 'invalid_private_record'); }
function conflict(): never { throw new PrivateNodeError(409, 'private_record_conflict'); }
function owner(household: string) {
  return createHash('sha256').update(JSON.stringify(['atarasy.private-node-owner.1', household])).digest('hex');
}
function storageKey(ownerDigest: string, id: string) { return `${ownerDigest}:${id}`; }
function decodedLength(value: string) {
  if (!base64url.test(value) || value.includes('=') || value.length % 4 === 1) invalid();
  return Buffer.from(value, 'base64url').byteLength;
}
function envelope(value: unknown): Envelope {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'ciphertext,nonce,profile') invalid();
  const candidate = value as Record<string, unknown>;
  if (candidate.profile !== 'atarasy.private-node-record.1' || typeof candidate.nonce !== 'string' || decodedLength(candidate.nonce) !== 12 || typeof candidate.ciphertext !== 'string') invalid();
  const bytes = decodedLength(candidate.ciphertext);
  // AES-GCM ciphertext includes a 16-byte authentication tag. Empty plaintext is not a useful node record.
  if (bytes <= 16 || bytes > maximumCiphertextBytes + 16) invalid();
  return { profile: candidate.profile, nonce: candidate.nonce, ciphertext: candidate.ciphertext };
}
function view(row: Stored) {
  return { id: row.id, revision: row.revision, updatedAt: row.updatedAt, envelope: { profile: row.profile, nonce: row.nonce, ciphertext: row.ciphertext } };
}

export function openPrivateNode(r: ReturnTypeMemberRuntime) {
  const rows = records<Stored>(r.path, 'private_node_records');
  function principal(token: string) {
    const session = r.authority.sessionPrincipal(token);
    if (!session) unavailable();
    return session;
  }
  function owned(token: string, id: string) {
    if (!uuid.test(id)) unavailable();
    const session = principal(token), expectedOwner = owner(session.household), row = rows.get(storageKey(expectedOwner, id));
    if (!row || row.owner !== expectedOwner || row.id !== id) unavailable();
    return row;
  }
  return {
    list(token: string) {
      const session = principal(token), expected = owner(session.household), found: ReturnType<typeof view>[] = [];
      rows.each(row => { if (row.owner === expected) found.push(view(row)); });
      found.sort((a, b) => a.id.localeCompare(b.id));
      if (found.length > 10_000) throw new PrivateNodeError(503, 'private_node_limit');
      return { profile: 'atarasy.private-node-index.1' as const, checkedAt: r.now(), records: found };
    },
    read(token: string, id: string) { return view(owned(token, id)); },
    write(token: string, id: string, expectedRevision: unknown, supplied: unknown) {
      if (!uuid.test(id) || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > maximumRevision) invalid();
      const session = principal(token), expectedOwner = owner(session.household), key = storageKey(expectedOwner, id), current = rows.get(key), value = envelope(supplied);
      if (current && (current.owner !== expectedOwner || current.id !== id)) unavailable();
      if ((current?.revision ?? 0) !== expectedRevision || expectedRevision === maximumRevision) conflict();
      const row: Stored = { owner: expectedOwner, id, revision: expectedRevision + 1, updatedAt: r.now(), ...value };
      rows.put(key, row);
      return view(row);
    },
  };
}
