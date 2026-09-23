import type {Pool} from 'pg';
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
 * The connection half of the guard, read from the connection string itself
 * rather than from a label beside it, so nothing typed on the command line
 * can defeat it. `weathered-violet-85512339`'s Vercel-managed endpoint is
 * `ep-curly-sound-b33yhpem` (and its pooled form, `-pooler`); every
 * production connection string this project has printed names one of the
 * two, and there is exactly one endpoint on this project, so a connection
 * string naming a third label is never this deployment's, whatever its
 * `NEON_PROJECT_ID` claims.
 *
 * No development endpoint id is recorded anywhere in this repository: only
 * the Neon project id (`young-pond-73223516`) and a branch name are
 * (README.md), and pulling an id from a live environment now, to check
 * against later, would mean pulling a secret this guard must not hold. Until
 * one is written down here, development keeps only the label check above and
 * the database check below.
 *
 * `ATARASY_TEST_PRODUCTION_ENDPOINT_LABEL` lets this project's own tests
 * stand a disposable local database in for production, which cannot be given
 * the real endpoint's hostname. Nothing but a test ever has reason to set it:
 * bootstrapping, an invitation or a proposal against the real project
 * connects over the real endpoint's own connection string, which already
 * carries the real label.
 */
const PRODUCTION_ENDPOINT_LABELS=new Set(['ep-curly-sound-b33yhpem','ep-curly-sound-b33yhpem-pooler']);
export function assertTargetConnection(target:Target,databaseURL:string,env:Record<string,string|undefined>=process.env):void{
 if(target.name!=='production')return;
 let host:string;
 try{host=new URL(databaseURL).hostname;}catch{throw new TargetError('Malformed database connection string');}
 const label=host.split('.')[0]??'';
 const testLabel=env.ATARASY_TEST_PRODUCTION_ENDPOINT_LABEL;
 const expected=testLabel?new Set([testLabel,testLabel+'-pooler']):PRODUCTION_ENDPOINT_LABELS;
 if(!expected.has(label))throw new TargetError(`Expected the production Neon endpoint (ep-curly-sound-b33yhpem or its pooler); connection string names ${label||'no host'}`);
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
