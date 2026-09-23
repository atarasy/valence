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
 * The exact-project guard. `NEON_PROJECT_ID` comes from the same Vercel
 * environment file as the connection string, so a file pulled from the other
 * project names the other project and is refused here before any connection.
 */
export function targetDatabaseURL(target:Target,env:Record<string,string|undefined>):string{
 if(env.NEON_PROJECT_ID!==target.neonProjectID||!env.DATABASE_URL_UNPOOLED)throw new TargetError(`Expected the dedicated Atarasy ${target.name} database (Neon ${target.neonProjectID})`);
 return env.DATABASE_URL_UNPOOLED;
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
