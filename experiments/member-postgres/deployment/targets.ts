import type {Pool} from 'pg';
import {parse as parsePostgresConnectionString} from 'pg-connection-string';
import {DEPLOYMENT_ID,PRODUCTION_DEPLOYMENT_ID} from './identity.ts';
import type {MemberRuntimeConfig} from '../config.ts';
import developmentConfig from './config.json';
import developmentAASA from './aasa.json';
import productionConfig from './production/config.json';
import productionAASA from './production/aasa.json';
/**
 * The two hosted deployments of the member API. Operator commands read the
 * target from here; the deployed entries do not, so a bundle carries only its
 * own target (see `serve.ts`).
 *
 * Each target is bound to exactly one Neon project. The two share no data, no
 * credentials and no passkeys: the relying party differs, so a passkey made for
 * one can never assert to the other.
 */
/** The guard's own refusals, printable by an operator command. */
export class TargetError extends Error {}
export type TargetName='development'|'production';
export type Target={name:TargetName;deploymentID:string;neonProjectID:string;config:MemberRuntimeConfig;aasa:unknown;entry:string;packageName:string};
export const TARGETS:Readonly<Record<TargetName,Target>>=Object.freeze({
 development:{name:'development',deploymentID:DEPLOYMENT_ID,neonProjectID:'young-pond-73223516',config:developmentConfig as MemberRuntimeConfig,aasa:developmentAASA,entry:new URL('./entry.ts',import.meta.url).pathname,packageName:'atarasy-api-dev'},
 production:{name:'production',deploymentID:PRODUCTION_DEPLOYMENT_ID,neonProjectID:'weathered-violet-85512339',config:productionConfig as MemberRuntimeConfig,aasa:productionAASA,entry:new URL('./production/entry.ts',import.meta.url).pathname,packageName:'atarasy-api'},
});
export function targetNamed(name:string):Target{
 if(name!=='development'&&name!=='production')throw new Error('Unknown target: expected development or production');
 return TARGETS[name];
}
/**
 * `[--target <name>] ...rest`. The default is development so that every
 * command written before production existed still means what it meant.
 */
export function parseTarget(argv:readonly string[]):{target:Target;rest:string[]}{
 if(argv[0]!=='--target')return {target:TARGETS.development,rest:[...argv]};
 if(!argv[1])throw new Error('--target needs a name: development or production');
 return {target:targetNamed(argv[1]),rest:argv.slice(2)};
}
/**
 * The label half of the guard. `NEON_PROJECT_ID` is whatever the operator
 * typed or put in `--env-file`, not necessarily the same source as the
 * connection string: PRODUCTION.md's own commands set it on the command
 * line, and a command-line value beats `--env-file`, so a stray value here
 * checks what the operator typed rather than proving anything about
 * `DATABASE_URL_UNPOOLED`. `assertTargetConnection` below is what checks the
 * connection string itself, and `assertTargetDatabase` checks the database
 * it opens; all three run before a bootstrap, invitation or proposal command
 * writes anything.
 */
export function targetDatabaseURL(target:Target,env:Record<string,string|undefined>):string{
 if(env.NEON_PROJECT_ID!==target.neonProjectID||!env.DATABASE_URL_UNPOOLED)throw new TargetError(`Expected the dedicated Atarasy ${target.name} database (Neon ${target.neonProjectID})`);
 return env.DATABASE_URL_UNPOOLED;
}
/**
 * The connection half of the guard, read from the connection string the way
 * `pg` itself reads it (`pg-connection-string`, the same parser `Pool` uses
 * internally), not from `new URL(...).hostname`. A round of this guard did
 * exactly that and a refutation pass found it proved nothing: a `?host=`
 * query parameter overrides the host `pg` actually connects to while leaving
 * the URL's own authority (and so `.hostname`) unchanged, so a connection
 * string could name the real project in its authority and a different host
 * entirely in `?host=`, pass, and connect to the second host. Comparing only
 * the first DNS label had the same shape of gap: any host beginning
 * `ep-curly-sound-b33yhpem.` passed, real endpoint or not.
 *
 * `weathered-violet-85512339`'s Vercel-managed endpoint is
 * `ep-curly-sound-b33yhpem.c-4.ap-southeast-1.aws.neon.tech` (and its pooled
 * form, `-pooler`); the whole hostname is compared, case-insensitively, and a
 * `?host=`/`hostaddr` override or a multi-host connection string is refused
 * outright for production, because none of those describes one traceable
 * connection to the one endpoint this project holds.
 *
 * No development endpoint id is recorded anywhere in this repository: only
 * the Neon project id (`young-pond-73223516`) and a branch name are
 * (README.md), and pulling an id from a live environment now, to check
 * against later, would mean pulling a secret this guard must not hold. Until
 * one is written down here, development keeps only the label check above and
 * the database check below.
 *
 * A disposable local database this project's own tests stand in for
 * production cannot be given the real endpoint's hostname, and a local
 * connection is otherwise refused above like any other non-matching host.
 * `allowLocalTestConnection` widens the accepted set to a bare local address
 * (`127.0.0.1`, `localhost`, or a socket path) and nothing else: it can never
 * admit a remote hostname, real or not, so it cannot be used to launder the
 * mismatch this guard exists to catch. A unit test passes it directly, as a
 * value nothing outside the test constructs; `review-invite.test.ts` drives
 * `bootstrap.ts`/`review-invite.ts`/`review-proposal.ts` as separate
 * processes and so has no function call to pass it through, and sets
 * `ATARASY_TEST_ALLOW_LOCAL_PRODUCTION_CONNECTION=1` in that subprocess's own
 * environment instead — a boolean switch, not a value that could name an
 * arbitrary label, so setting it can still only unlock a local address.
 */
const PRODUCTION_ENDPOINT_HOSTS=new Set(['ep-curly-sound-b33yhpem.c-4.ap-southeast-1.aws.neon.tech','ep-curly-sound-b33yhpem-pooler.c-4.ap-southeast-1.aws.neon.tech']);
function isLocalConnectionHost(host:string):boolean{
 return host==='127.0.0.1'||host==='localhost'||host.startsWith('/');
}
export function assertTargetConnection(target:Target,databaseURL:string,options:{allowLocalTestConnection?:boolean}={}):void{
 if(target.name!=='production')return;
 const parsed=parsePostgresConnectionString(databaseURL);
 const host=(parsed.host??'').toLowerCase();
 if(!host)throw new TargetError('Expected the production Neon endpoint; connection string names no host');
 if(host.includes(','))throw new TargetError('Expected the production Neon endpoint; connection string names multiple hosts');
 if((parsed as Record<string,unknown>).hostaddr)throw new TargetError('Expected the production Neon endpoint; connection string sets hostaddr');
 const allowLocal=options.allowLocalTestConnection??process.env.ATARASY_TEST_ALLOW_LOCAL_PRODUCTION_CONNECTION==='1';
 if(allowLocal&&isLocalConnectionHost(host))return;
 if(!PRODUCTION_ENDPOINT_HOSTS.has(host))throw new TargetError(`Expected the production Neon endpoint (${[...PRODUCTION_ENDPOINT_HOSTS].join(' or ')}); connection string names ${host}`);
}
/**
 * The second half of the guard, read from the database itself rather than from
 * a label beside it: a database that already holds a deployment scoped to the
 * other target's environment is not this target's. A fresh database has no
 * control table yet and passes. Rows of any third environment (a test's, a
 * local one) are not read as either target.
 */
export async function assertTargetDatabase(pool:Pool,target:Target):Promise<void>{
 const {rows:[table]}=await pool.query<{present:boolean}>("SELECT to_regclass('atarasy_member.control') IS NOT NULL AS present");
 if(!table?.present)return;
 const others=Object.values(TARGETS).filter(t=>t.name!==target.name).map(t=>t.config.environment);
 const {rows}=await pool.query<{n:number}>('SELECT count(*)::int AS n FROM atarasy_member.control WHERE environment=ANY($1)',[others]);
 if(rows[0]!.n>0)throw new TargetError(`Database holds a deployment of another target; refusing to run as ${target.name}`);
}
