import { Database } from 'bun:sqlite';
import type { Ownership, Resource } from './gate.ts';
import type { openMemberAuthority } from './authority.ts';

/** A trusted path to the exact engine store behind the protected handler. */
export function openDurableOwnership(path: string, authority: ReturnType<typeof openMemberAuthority>) {
  const db = new Database(path, { readonly: true, strict: true });
  function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
  return {
    async ownerOf(resource: Resource): Promise<Ownership | undefined> {
      if (resource.kind !== 'offer' && resource.kind !== 'mandate') throw new Error('Unknown resource kind');
      const table = resource.kind === 'offer' ? 'offers' : 'mandates';
      const row = db.query(`SELECT v FROM ${table} WHERE k=?`).get(resource.id) as { v: string } | null;
      if (!row) { authority.invalidateResource(resource); return; }
      const record: unknown = JSON.parse(row.v);
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid durable resource');
      const value = record as Record<string, unknown>;
      if (value.id !== resource.id || !text(value.household) || (resource.kind === 'offer' && !text(value.presenter))) throw new Error('Invalid durable ownership');
      const owner: Ownership = resource.kind === 'offer' ? { household: value.household, presenter: value.presenter as string } : { household: value.household };
      try { authority.bindResource(resource, owner); }
      catch (error) {
        // A conflict or tombstone never repairs itself by trusting the latest row.
        authority.invalidateResource(resource);
        throw error;
      }
      return authority.ownerOf(resource);
    },
    close() { db.close(); },
  };
}
