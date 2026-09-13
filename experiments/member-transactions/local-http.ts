import { validateNodeImport, validateArchiveDependencies } from './node-import.ts';
import { createApp } from '../../engine/src/http.ts';
import { ValenceEngine } from '../../engine/src/engine/offers.ts';
import { InMemoryLedger } from '../../engine/src/engine/ledger.ts';
import { LocalDeliveries } from '../../engine/src/engine/delivery-source.ts';
import { DeliveryRegister } from '../../engine/src/hub/delivery.ts';
import { RecoveryRegister } from '../../engine/src/hub/node.ts';
import { ApprovalDesk } from '../../engine/src/hub/approval.ts';
import { PermissionLedger } from '../../engine/src/hub/permissions.ts';
import { Registry } from '../../engine/src/shared/registry.ts';
import { openAtomicStore } from './atomic-store.ts';

type Policy = { environment: string; origin: string; rpID: string; explorationRate: number; reminderLimit: 0 | 1; recoveryGraceDays: number; maximumBodyBytes: number; maximumResponseBytes: number; maximumPending: number };
type Materialised = { status: number; headers: [string, string][]; body: Uint8Array };
class RollbackResponse { constructor(readonly result: Materialised) {} }
const error = (status: number, code: string) => Response.json({ error: code }, { status });
async function bounded(stream: ReadableStream<Uint8Array> | null, maximum: number): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(), parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) { void reader.cancel().catch(() => {}); throw new Error('Payload limit'); }
      parts.push(next.value.slice());
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0;
  for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
  return body;
}
/** Internal harness only. No listener, member route or remote side effect. */
export function openLocalHTTP(path: string, options: Policy) {
  const p = Object.freeze({ ...options });
  if (Object.keys(p).sort().join(',') !== 'environment,explorationRate,maximumBodyBytes,maximumPending,maximumResponseBytes,origin,recoveryGraceDays,reminderLimit,rpID') throw new Error('Invalid local HTTP policy');
  const origin = new URL(p.origin);
  if (!p.environment || origin.origin !== p.origin || origin.protocol !== 'https:' || origin.hostname !== p.rpID || !(p.explorationRate > 0 && p.explorationRate <= 1) || ![0, 1].includes(p.reminderLimit) || !Number.isSafeInteger(p.recoveryGraceDays) || p.recoveryGraceDays < 0) throw new Error('Invalid local HTTP policy');
  for (const n of [p.maximumBodyBytes, p.maximumResponseBytes, p.maximumPending]) if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Invalid local HTTP bounds');
  const unit = openAtomicStore(path, { environment: p.environment, audience: p.origin });
  let pending = 0, closed = false, tail: Promise<unknown> = Promise.resolve();
  return {
    async fetch(request: Request): Promise<Response> {
      if (closed || pending >= p.maximumPending) return error(503, 'local_unavailable');
      pending++;
      try {
        if (new URL(request.url).origin !== p.origin) return error(400, 'wrong_origin');
        let body: Uint8Array;
        try { body = await bounded(request.body, p.maximumBodyBytes); } catch { return error(413, 'body_unavailable'); }
        if (request.signal.aborted) return error(400, 'request_aborted');
        let archive: ReturnType<typeof validateNodeImport> | undefined;
        const parts = new URL(request.url).pathname.split('/').filter(Boolean);
        if (request.method === 'POST' && parts.length === 3 && parts[0] === 'households' && parts[2] === 'import') {
          try { archive = validateNodeImport(JSON.parse(new TextDecoder().decode(body)), decodeURIComponent(parts[1]!)); }
          catch { return error(400, 'invalid_node_archive'); }
        }
        const fixed = new Request(request.url, { method: request.method, headers: request.headers, ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: body.slice().buffer }) });
        const work = tail.then(async () => {
          try {
            return await unit.run(async store => {
              const registry = new Registry(store), ledger = new InMemoryLedger(store);
              const engine = new ValenceEngine(ledger, { explorationRate: p.explorationRate, reminderLimit: p.reminderLimit, recoveryGraceDays: p.recoveryGraceDays, relyingPartyId: p.rpID, isInNetwork: merchant => { try { registry.resolve(merchant); return true; } catch { return false; } } }, store);
              const hub = { registry, recovery: new RecoveryRegister(store), approvals: new ApprovalDesk(store), permissions: new PermissionLedger(store), deliveries: new DeliveryRegister(store) };
              engine.readDeliveriesFrom(new LocalDeliveries(hub.deliveries));
              if (archive) validateArchiveDependencies(archive, engine);
              const response = await createApp(engine, hub)(fixed);
              const result: Materialised = { status: response.status, headers: [...response.headers.entries()], body: await bounded(response.body, p.maximumResponseBytes) };
              if (!response.ok) throw new RollbackResponse(result);
              return result;
            });
          } catch (cause) {
            if (cause instanceof RollbackResponse) return cause.result;
            throw cause;
          }
        });
        tail = work.catch(() => {});
        const result = await work;
        return new Response([204, 205].includes(result.status) || request.method === 'HEAD' ? null : result.body.slice().buffer, { status: result.status, headers: result.headers });
      } catch { return error(500, 'local_request_failed'); }
      finally { pending--; }
    },
    close() { if (pending) throw new Error('Local requests still active'); if (!closed) { closed = true; unit.close(); } },
  };
}
