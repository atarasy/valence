import { createPublicKey } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/** Closed initial bridge profile: EC2 / ES256 / P-256, no extra or trailing data. */
export function credentialSPKI(bytes: Uint8Array): Buffer {
  const input = new Uint8Array(bytes);
  if (input.length > 4096) throw new Error('Unsupported credential key');
  const key = isoCBOR.decodeFirst<Map<number, number | Uint8Array>>(input);
  if (!(key instanceof Map) || key.size !== 5 || ![1, 3, -1, -2, -3].every(k => key.has(k)) ||
      key.get(1) !== 2 || key.get(3) !== -7 || key.get(-1) !== 1 ||
      !Buffer.from(isoCBOR.encode(key)).equals(Buffer.from(input))) throw new Error('Unsupported credential key');
  const x = key.get(-2), y = key.get(-3);
  if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) throw new Error('Unsupported credential key');
  return createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: Buffer.from(x).toString('base64url'), y: Buffer.from(y).toString('base64url') } }).export({ format: 'der', type: 'spki' });
}
