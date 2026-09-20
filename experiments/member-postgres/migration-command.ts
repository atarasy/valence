import { readFileSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import type { Pool } from 'pg';
import { createPool, type Identity } from './store.ts';
import { memberRuntimeIdentity, type MemberRuntimeConfig } from './config.ts';
import { captureDeployment, freezeDeployment, restoreDeploymentCandidate, activateDeploymentCandidate, abortDeploymentMigration, type DeploymentSnapshot } from './operational-snapshot.ts';
export type MigrationPlan = { identity: Identity; ticket: string; runtimeFingerprint: string; config: MemberRuntimeConfig };
const commands = ['inspect-source','inspect-target','freeze','restore','activate','abort'] as const;
export type MigrationCommand = typeof commands[number];
const refuse = (): never => { throw new Error('Migration command refused'); };
export function readMigrationPlan(path: string): MigrationPlan {
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {const stat=fstatSync(fd);if(!stat.isFile()||stat.size>65536)refuse();return JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}
}
function validate(plan: MigrationPlan) {
 const p=structuredClone(plan);
 if(!p||Object.keys(p).sort().join(',')!=='config,identity,runtimeFingerprint,ticket'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(p.ticket)||!/^[a-f0-9]{64}$/.test(p.runtimeFingerprint))refuse();
 const runtime=memberRuntimeIdentity(p.config);
 if(p.identity.environment!==p.config.environment||p.identity.origin!==p.config.origin)refuse();
 return {p,runtime};
}
function checkRuntime(snapshot: DeploymentSnapshot, fingerprint: string) {
 const rows=snapshot.rows.filter(r=>r.namespace==='member_config');if(rows.length!==1||rows[0]!.key!=='current')refuse();
 const held=JSON.parse(rows[0]!.value);
 if(held.profile!=='atarasy.member-runtime.1'||held.fingerprint!==fingerprint||memberRuntimeIdentity(held.config).fingerprint!==fingerprint)refuse();
}
function summary(snapshot: DeploymentSnapshot) {
 const row=snapshot.rows.find(r=>r.namespace==='member_writer_migration'&&r.key==='current');
 const target=snapshot.rows.find(r=>r.namespace==='member_writer_target'&&r.key==='current');
 const raw=row?JSON.parse(row.value):null, destination=target?JSON.parse(target.value):null;
 const phase=raw?.phase==='retired'?'retired':raw?.phase==='frozen'?(destination?.phase==='active'?'active':destination?.phase==='ready'?'candidate':'frozen'):'unfrozen';
 return {enabled:snapshot.sourceEnabled,phase,digest:snapshot.digest};
}
/** In-memory transfer only. Neither snapshots nor connection URLs are returned. */
export async function runMigrationCommand(command: MigrationCommand, plan: MigrationPlan, env: Record<string,string|undefined>) {
 if(!commands.includes(command))refuse();const {p,runtime}=validate(plan);
 const sourceURL=env.ATARASY_MIGRATION_SOURCE_URL,targetURL=env.ATARASY_MIGRATION_TARGET_URL;
 const needsSource=command!=='inspect-target',needsTarget=['inspect-target','restore','activate'].includes(command);
 if((needsSource&&!sourceURL)||(needsTarget&&!targetURL))refuse();
 let source:Pool|undefined,target:Pool|undefined;
 try {
  if(needsSource)source=createPool(sourceURL!);if(needsTarget)target=createPool(targetURL!);
  const selected=command==='inspect-target'?target!:source!,snapshot=await captureDeployment(selected,p.identity);checkRuntime(snapshot,runtime.fingerprint);
  if(command==='inspect-source'||command==='inspect-target')return {ok:true,command,...summary(snapshot)};
  if(command==='freeze'){const frozen=await freezeDeployment(source!,p.identity,p.ticket,p.runtimeFingerprint);checkRuntime(frozen,runtime.fingerprint);return {ok:true,command,...summary(frozen)};}
  if(command==='abort'){await abortDeploymentMigration(source!,p.identity,p.ticket,p.runtimeFingerprint);return {ok:true,command,aborted:true};}
  if(command==='restore'){
   if(snapshot.sourceEnabled)refuse();
   const frozen=await freezeDeployment(source!,p.identity,p.ticket,p.runtimeFingerprint);checkRuntime(frozen,runtime.fingerprint);
   const exists=await target!.query('SELECT 1 FROM atarasy_member.control WHERE id=$1',[p.identity.id]);
   if(exists.rowCount){
    const held=await captureDeployment(target!,p.identity);checkRuntime(held,runtime.fingerprint);
    if(held.sourceEnabled||held.schema!==frozen.schema||JSON.stringify(held.rows.filter(r=>r.namespace!=='member_writer_target'))!==JSON.stringify(frozen.rows))refuse();
    const candidates=held.rows.filter(r=>r.namespace==='member_writer_target');if(candidates.length!==1||candidates[0]!.key!=='current')refuse();
    const candidate=JSON.parse(candidates[0]!.value),freeze=JSON.parse(frozen.rows.find(r=>r.namespace==='member_writer_migration'&&r.key==='current')!.value);
    if(Object.keys(candidate).sort().join(',')!=='content,instance,phase,runtime,schema,ticket'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(candidate.instance)||candidate.phase!=='ready'||candidate.ticket!==p.ticket||candidate.runtime!==p.runtimeFingerprint||candidate.content!==freeze.content||candidate.schema!==frozen.schema)refuse();
   }else await restoreDeploymentCandidate(target!,frozen,p.identity);
   return {ok:true,command,restored:true,enabled:false};
  }
  const destination=await captureDeployment(target!,p.identity);checkRuntime(destination,runtime.fingerprint);
  const result=await activateDeploymentCandidate(source!,target!,p.identity,p.ticket,p.runtimeFingerprint);
  return {ok:true,command,...result};
 } finally {await Promise.all([source?.end(),target?.end()]);}
}
if(import.meta.main){
 try {
  const [command,path,...extra]=process.argv.slice(2);if(!command||!path||extra.length||!commands.includes(command as MigrationCommand))refuse();
  const result=await runMigrationCommand(command as MigrationCommand,readMigrationPlan(path!),process.env);process.stdout.write(JSON.stringify(result)+'\n');
 }catch{process.stderr.write(JSON.stringify({ok:false,error:'migration_failed',next:'Inspect source and target with the same plan before retrying. No routing was changed.'})+'\n');process.exitCode=1;}
}
