import type { Identity } from './store.ts';
import type { MemberRuntimeConfig } from './config.ts';
import baseConfig from './deployment/config.json';

/**
 * OPS-01 (a second developer runs this package with no production account,
 * against a throwaway local PostgreSQL, never Neon). `local.ts` and
 * `local-presenter-credential.ts` are the only two entry points allowed to
 * touch a database outside Neon, and both funnel their connection string
 * through this guard before doing anything with it.
 */
export function assertLocalDatabaseUrl(connectionString:string):void {
 let url:URL;
 try{url=new URL(connectionString);}catch{throw new Error('LOCAL_DATABASE_URL is not a valid connection string');}
 if(url.protocol!=='postgres:'&&url.protocol!=='postgresql:')throw new Error('LOCAL_DATABASE_URL must be a postgres:// connection string');
 const hostParam=url.searchParams.get('host'),isUnixSocket=typeof hostParam==='string'&&hostParam.startsWith('/');
 const isLoopbackHost=['127.0.0.1','localhost','::1','[::1]',''].includes(url.hostname);
 if(!isUnixSocket&&!isLoopbackHost)throw new Error('LOCAL_DATABASE_URL must point at 127.0.0.1, localhost, ::1 or a unix socket; refusing a non-local database so this can never reach Neon');
}

/** PORT, or 8788 if unset. Both local entry points read the same variable, so a credential issued against one port cannot silently bind to a server running on another. */
export function localPort():number {
 const raw=process.env.PORT;
 if(!raw)return 8788;
 const port=Number(raw);
 if(!Number.isInteger(port)||port<=0||port>65535)throw new Error('PORT must be a whole number between 1 and 65535');
 return port;
}

/** Fixed on purpose: one local deployment per machine, the same one `local.ts` and `local-presenter-credential.ts` write under. */
export const LOCAL_DEPLOYMENT_ID='atarasy_local';

export function localIdentity(port:number):Identity {
 return {id:LOCAL_DEPLOYMENT_ID,environment:'local',origin:`http://127.0.0.1:${port}`,epoch:1};
}

/** Everything deployment/config.json pins except the three fields OPS-01 replaces: environment, origin and rpID. */
export function localConfig(port:number):MemberRuntimeConfig {
 return {...(baseConfig as MemberRuntimeConfig),environment:'local',origin:`http://127.0.0.1:${port}`,rpID:'127.0.0.1'};
}
