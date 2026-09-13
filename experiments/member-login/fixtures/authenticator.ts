import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest();
// Small independent CBOR fixture encoder. Never used by the production verifier.
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
}
function cbor(value: string | Buffer | Map<string, unknown>): Buffer {
  if (typeof value === 'string') { const bytes = Buffer.from(value); return Buffer.concat([head(3, bytes.length), bytes]); }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k,v]) => [cbor(k), cbor(v as string | Buffer | Map<string, unknown>)])]);
}
export function syntheticAuthenticator() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([Buffer.from('a5010203262001215820','hex'), Buffer.from(jwk.x!, 'base64url'), Buffer.from('225820','hex'), Buffer.from(jwk.y!, 'base64url')]);
  const idBytes = randomBytes(32), id = idBytes.toString('base64url');
  return {
    id, cose,
    register(challenge: string, origin: string, rp: string, changes: { type?: string; flags?: number; id?: string } = {}): RegistrationResponseJSON {
      const length = Buffer.alloc(2); length.writeUInt16BE(idBytes.length);
      const authData = Buffer.concat([hash(rp), Buffer.from([changes.flags ?? 0x45]), Buffer.alloc(4), Buffer.alloc(16), length, idBytes, cose]);
      const attestation = cbor(new Map<string, unknown>([['fmt','none'],['attStmt',new Map()],['authData',authData]]));
      const client = Buffer.from(JSON.stringify({ type: changes.type ?? 'webauthn.create', challenge, origin }));
      return { id: changes.id ?? id, rawId: changes.id ?? id, type: 'public-key', clientExtensionResults: { credProps: { rk: true } }, response: { clientDataJSON: client.toString('base64url'), attestationObject: attestation.toString('base64url'), transports: ['internal'] } };
    },
    authenticate(challenge: string, origin: string, rp: string, userHandle: string, counter = 1): AuthenticationResponseJSON {
      const count = Buffer.alloc(4); count.writeUInt32BE(counter);
      const authData = Buffer.concat([hash(rp), Buffer.from([5]), count]);
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
      const signature = sign('sha256', Buffer.concat([authData, hash(client)]), pair.privateKey);
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: client.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url'), userHandle } };
    },
  };
}
