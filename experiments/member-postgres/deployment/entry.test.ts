import { expect, test } from 'bun:test';
import { failureReason } from './entry.ts';

test('a known startup message passes through unchanged', () => {
 expect(failureReason(new Error('Bound runtime mismatch'))).toBe('Bound runtime mismatch');
 expect(failureReason(new Error('PostgreSQL writer fenced'))).toBe('PostgreSQL writer fenced');
 expect(failureReason(new Error('Invalid member runtime limits'))).toBe('Invalid member runtime limits');
});

test('an unlisted message is never printed, even from this package\'s own errors', () => {
 // Distinguishes the allow-list from "any Error with a plain message is safe":
 // a message this package could throw but has not registered must still fall
 // through to the generic name, not leak verbatim.
 expect(failureReason(new Error('PostgreSQL scope ended'))).toBe('Error');
});

test('a pg-style error carrying a host and a password redacts to its SQLSTATE only', () => {
 const error = Object.assign(
  new Error('password authentication failed for user "app_writer" at host db.pooler.neon.tech:5432 with password "hunter2-secret"'),
  { code: '28P01' },
 );
 const reason = failureReason(error);
 expect(reason).toBe('database error 28P01');
 expect(reason).not.toContain('neon.tech');
 expect(reason).not.toContain('hunter2-secret');
 expect(reason).not.toContain('app_writer');
});

test('a code that is not exactly five alphanumeric characters is not treated as a SQLSTATE', () => {
 expect(failureReason(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' }))).toBe('Error');
 expect(failureReason(Object.assign(new Error('short'), { code: 'AB1' }))).toBe('Error');
});

test('a random Error yields its name, never its message', () => {
 expect(failureReason(new TypeError('reading property of undefined at 10.0.0.5'))).toBe('TypeError');
 class ArtifactError extends Error {}
 expect(failureReason(new ArtifactError('do not print this'))).toBe('Error');
});

test('a thrown non-Error value is unknown', () => {
 expect(failureReason('a bare string throw')).toBe('unknown');
 expect(failureReason(undefined)).toBe('unknown');
 expect(failureReason({ message: 'looks like an error but is not one' })).toBe('unknown');
});
