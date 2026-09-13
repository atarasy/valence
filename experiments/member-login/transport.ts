import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { openMemberAuthority } from '../member-read/authority.ts';
import type { openVerifiedLogin } from './login.ts';
import type { openEnrollment } from './enrollment.ts';
type Deps = {
  authority: ReturnType<typeof openMemberAuthority>; login: ReturnType<typeof openVerifiedLogin>; enrollment: ReturnType<typeof openEnrollment>;
  read: (request: Request) => Promise<Response>;
  admit: (context: { peer: string; operation: string }) => Promise<boolean>;
  maxBodyBytes: number;
};
const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const refused = (status: number) => json(status, { error: status === 429 ? 'rate_limited' : 'request_unavailable', message: 'Request unavailable.' });
async function body(request: Request, limit: number): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new Error('JSON required');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error('Invalid length');
  if (!request.body) throw new Error('Body required');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > limit) { void reader.cancel().catch(() => {}); throw new Error('Body too large'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Object required');
  return decoded as Record<string, unknown>;
}
function shape(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) throw new Error('Unexpected fields');
}
export function memberTransport(deps: Deps) {
  if (!Number.isSafeInteger(deps.maxBodyBytes) || deps.maxBodyBytes < 1 || typeof deps.admit !== 'function') throw new Error('Explicit transport bounds required');
  const origin = deps.authority.scope.audience;
  if (deps.login.scope.origin !== origin || deps.login.scope.environment !== deps.authority.scope.environment) throw new Error('Transport scope mismatch');
  return async (request: Request, context: { peer: string }): Promise<Response> => {
    const url = new URL(request.url);
    if (url.origin !== origin || url.username || url.password || url.hash || request.headers.has('cookie') || (request.headers.has('origin') && request.headers.get('origin') !== origin) || ['cross-site','same-site'].includes(request.headers.get('sec-fetch-site') ?? '')) return refused(403);
    if (typeof context?.peer !== 'string' || !context.peer || context.peer.length > 256) return refused(503);
    const path = url.pathname;
    const authRoute = ['/auth/enrollment/options','/auth/enrollment/verify','/auth/login/options','/auth/login/verify','/auth/logout','/auth/session'].includes(path);
    const operation = authRoute ? path : 'member-read';
    try { if (!await deps.admit({ peer: context.peer, operation })) return refused(429); } catch { return refused(503); }
    if (!authRoute) {
      if (path.startsWith('/auth')) return refused(404);
      try { return await deps.read(request); } catch { return refused(503); }
    }
    if (url.search) return refused(404);
    if (path === '/auth/session') {
      if (request.method !== 'GET') return refused(404);
      try {
        const token = request.headers.get('authorization')?.match(/^Bearer (amr1_[A-Za-z0-9_-]{43})$/)?.[1];
        const session = token ? await deps.authority.resolveSession(token) : undefined;
        if (!session) return refused(401);
        return json(200, { id: session.id, household: session.household, presenters: session.presenters, expiresAt: session.expiresAt });
      } catch { return refused(503); }
    }
    if (request.method !== 'POST') return refused(404);
    let input: Record<string, unknown>;
    try {
      input = await body(request, deps.maxBodyBytes);
      shape(input, path.endsWith('/verify') ? ['id','response'] : path === '/auth/enrollment/options' ? ['invitation'] : []);
      if (path.endsWith('/verify') && (typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/.test(input.id) || !input.response || typeof input.response !== 'object' || Array.isArray(input.response))) throw new Error('Invalid ceremony');
      if (path === '/auth/enrollment/options' && typeof input.invitation !== 'string') throw new Error('Invalid invitation');
    } catch { return refused(400); }
    try {
      if (path === '/auth/login/options') return json(200, deps.login.begin());
      if (path === '/auth/login/verify') return json(200, await deps.login.finish(input.id as string, input.response as unknown as AuthenticationResponseJSON));
      if (path === '/auth/enrollment/options') return json(200, await deps.enrollment.begin(input.invitation as string));
      if (path === '/auth/enrollment/verify') return json(201, await deps.enrollment.finish(input.id as string, input.response as unknown as RegistrationResponseJSON));
      const token = request.headers.get('authorization')?.match(/^Bearer (amr1_[A-Za-z0-9_-]{43})$/)?.[1];
      if (!token) return refused(401);
      const session = await deps.authority.resolveSession(token);
      if (session) deps.authority.revokeSession(session.id);
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    } catch { return refused(401); }
  };
}
