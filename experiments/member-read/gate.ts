import { validProjection } from './projection.ts';
/** Opt-in read boundary. Trusted adapters are required; this is not a token verifier. */
export type Session = {
  id: string; environment: string; household: string; presenters: readonly string[];
  expiresAt: number; revoked: boolean;
};
export type Resource = { kind: 'offer' | 'mandate'; id: string };
export type Ownership = { household: string; presenter?: string };
export type Dependencies = {
  environment: string;
  origin: string;
  resolveSession: (token: string) => Promise<Session | undefined>;
  ownerOf: (resource: Resource) => Promise<Ownership | undefined>;
  next: (request: Request) => Promise<Response>;
  now?: () => number;
};
type Route = { kind: 'list'; household: string; presenter: string } | { kind: 'resource'; resource: Resource; action?: string };
const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const fail = (status: number, code: string) => new Response(JSON.stringify({ error: code, message: status === 401 ? 'Session unavailable.' : 'Resource unavailable.' }), { status, headers });
const pathID = /^[A-Za-z0-9_-]+$/;
function route(request: Request, origin: string): Route | undefined {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== origin || url.username || url.password || url.hash) return;
  const parts = url.pathname.split('/');
  if (url.pathname === '/offers') {
    const keys = [...url.searchParams.keys()];
    const household = url.searchParams.get('household'), presenter = url.searchParams.get('presenter');
    if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes('household') || !keys.includes('presenter') || !household || !presenter) return;
    return { kind: 'list', household, presenter };
  }
  if ([...url.searchParams].length) return;
  if (parts.length === 4 && parts[1] === '_node' && parts[2] === 'mandates' && pathID.test(parts[3]!)) return { kind: 'resource', resource: { kind: 'mandate', id: parts[3]! } };
  if (parts[1] !== 'offers' || !pathID.test(parts[2] ?? '')) return;
  if (parts.length === 3) return { kind: 'resource', resource: { kind: 'offer', id: parts[2]! } };
  if (parts.length === 4 && ['approval', 'statement', 'settlement'].includes(parts[3]!)) return { kind: 'resource', resource: { kind: 'offer', id: parts[2]! }, action: parts[3] };
}
function fingerprint(session: Session): string {
  return JSON.stringify([session.id, session.environment, session.household, session.expiresAt, [...session.presenters].sort()]);
}
function validSession(session: Session | undefined, environment: string, now: number): session is Session {
  return !!session && typeof session.id === 'string' && !!session.id && session.environment === environment && typeof session.household === 'string' && !!session.household && session.revoked === false && Number.isSafeInteger(session.expiresAt) && session.expiresAt > now && Array.isArray(session.presenters) && session.presenters.every(p => typeof p === 'string' && !!p);
}
function permitted(session: Session, route: Route, owner?: Ownership): boolean {
  if (route.kind === 'list') return route.household === session.household && session.presenters.includes(route.presenter);
  return !!owner && owner.household === session.household && (route.resource.kind === 'mandate' || (typeof owner.presenter === 'string' && session.presenters.includes(owner.presenter)));
}
function ownerKey(owner: Ownership | undefined): string { return JSON.stringify([owner?.household, owner?.presenter]); }
function projection(body: any, route: Route, owner?: Ownership): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (route.kind === 'list') return Array.isArray(body.offers) && body.offers.every((o: any) => o && o.household === route.household && o.presenter === route.presenter);
  if (route.resource.kind === 'mandate') return body.id === route.resource.id && body.household === owner?.household;
  if (!route.action) return body.id === route.resource.id && body.household === owner?.household && body.presenter === owner?.presenter;
  if (body.offer !== route.resource.id) return false;
  if (route.action === 'approval') return body.presenter === owner?.presenter;
  if (route.action === 'statement') return body.household === owner?.household;
  return true; // Settlement identifies only the offer; authority is the ownership index.
}
export function memberReadBoundary(deps: Dependencies): (request: Request) => Promise<Response> {
  if (!deps.environment || new URL(deps.origin).origin !== deps.origin || !deps.origin.startsWith('https://')) throw new Error('An explicit HTTPS origin and environment are required');
  const now = deps.now ?? Date.now;
  return async request => {
    try {
      const auth = request.headers.get('authorization');
      const token = auth?.match(/^Bearer ([A-Za-z0-9._~-]+)$/)?.[1];
      if (!token) return fail(401, 'session_unavailable');
      const session = await deps.resolveSession(token);
      if (!validSession(session, deps.environment, now())) return fail(401, 'session_unavailable');
      // Copy before awaited work so a mutable resolver record cannot change this grant.
      const sessionKey = fingerprint(session);
      const snapshot = { ...session, presenters: [...session.presenters] };
      const selected = route(request, deps.origin);
      if (!selected) return fail(404, 'resource_unavailable');
      const ownership = selected.kind === 'resource' ? await deps.ownerOf(selected.resource) : undefined;
      const scopeKey = ownerKey(ownership);
      if (!permitted(snapshot, selected, ownership)) return fail(404, 'resource_unavailable');
      const ownerSnapshot = ownership ? { ...ownership } : undefined;
      async function stillPermitted(): Promise<boolean> {
        // Ownership lookup may await; session validation follows it, immediately
        // before forwarding/delivery. Both need authoritative production adapters.
        const currentOwner = selected!.kind === 'resource' ? await deps.ownerOf(selected!.resource) : undefined;
        if (ownerKey(currentOwner) !== scopeKey) return false;
        const currentSession = await deps.resolveSession(token!);
        return validSession(currentSession, deps.environment, now()) && fingerprint(currentSession) === sessionKey && permitted(currentSession, selected!, currentOwner);
      }
      if (!await stillPermitted()) return fail(404, 'resource_unavailable');
      // Do not pass credentials or caller-controlled identity headers to the engine.
      const upstream = await deps.next(new Request(request.url, { method: 'GET', headers: { accept: 'application/json' } }));
      const media = upstream.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (media !== 'application/json') return fail(503, 'read_unavailable');
      const body = await upstream.json();
      if (!await stillPermitted()) return fail(404, 'resource_unavailable');
      if (upstream.status === 404) return fail(404, 'resource_unavailable');
      if ([400, 409, 422].includes(upstream.status) && body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 2 && typeof body.message === 'string' && typeof body.error === 'string' && /^[a-z0-9_]{1,128}$/.test(body.error)) {
        return new Response(JSON.stringify({ error: body.error, message: 'Read refused.' }), { status: upstream.status, headers });
      }
      if (upstream.status !== 200) return fail(503, 'read_unavailable');
      const schema = selected.kind === 'list' ? 'list' : selected.resource.kind === 'mandate' ? 'mandate' : (selected.action ?? 'offer') as 'offer' | 'approval' | 'statement' | 'settlement';
      if (!validProjection(schema, body) || !projection(body, selected, ownerSnapshot)) return fail(503, 'read_unavailable');
      if (selected.kind === 'list') {
        // Lists must not bypass the authoritative resource source used by detail reads.
        for (const offer of body.offers) {
          const owner = await deps.ownerOf({ kind: 'offer', id: offer.id });
          if (!owner || owner.household !== selected.household || owner.presenter !== selected.presenter) return fail(503, 'read_unavailable');
        }
        if (!await stillPermitted()) return fail(404, 'resource_unavailable');
      }
      return new Response(JSON.stringify(body), { status: 200, headers });
    } catch { return fail(503, 'read_unavailable'); }
  };
}
