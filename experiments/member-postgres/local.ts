import { isIP } from 'node:net';
import { migrateDatabase } from './migrate.ts';
import { createPool, initialiseDeployment } from './store.ts';
import { openPostgresMemberHTTP } from './http.ts';
import { assertLocalDatabaseUrl, localPort, localIdentity, localConfig } from './local-shared.ts';

/**
 * Running it locally (OPS-01). This is the member API `experiments/member-postgres`
 * builds for `https://api-dev.vox.delivery`, pointed at a throwaway local
 * PostgreSQL instead of Neon, with no Vercel ingress and no production account.
 *
 * `deployment/entry.ts` trusts Vercel for the peer address
 * (`x-vercel-forwarded-for`) and for TLS; neither exists here, so this reads
 * the peer straight from the TCP connection Bun.serve accepted and serves
 * plain http://127.0.0.1. `assertLocalDatabaseUrl` is what stands in for
 * Vercel's own boundary: nothing here can reach Neon.
 */
export async function startLocalServer() {
 const databaseUrl=process.env.LOCAL_DATABASE_URL;
 if(!databaseUrl)throw new Error('LOCAL_DATABASE_URL required (a local PostgreSQL connection string, e.g. postgres://127.0.0.1/atarasy_local)');
 assertLocalDatabaseUrl(databaseUrl);

 const port=localPort(),identity=localIdentity(port),config=localConfig(port);

 await migrateDatabase(databaseUrl);
 const pool=createPool(databaseUrl);
 await initialiseDeployment(pool,identity);
 const app=await openPostgresMemberHTTP(pool,identity,config);

 const server=Bun.serve({
  hostname:'127.0.0.1',
  port,
  async fetch(request,srv){
   const peer=srv.requestIP(request)?.address;
   if(!peer||!isIP(peer))return Response.json({error:'unavailable'},{status:503,headers:{'cache-control':'no-store'}});
   return app.fetch(request,{peer});
  },
 });

 return {server,pool,identity,config};
}

if(import.meta.main){
 const {identity,config}=await startLocalServer();
 console.log(`atarasy local member API listening on ${config.origin}`);
 console.log(`deployment id ${identity.id}, environment ${config.environment}`);
 console.log('stop with Ctrl-C; nothing here persists once the local PostgreSQL it points at is reset');
}
