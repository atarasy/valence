import {createHash} from 'node:crypto';
import {openSync,closeSync,fstatSync,readFileSync,writeFileSync,lstatSync,readdirSync,constants} from 'node:fs';
import {resolve,join} from 'node:path';
import {memberRuntimeIdentity,type MemberRuntimeConfig} from './config.ts';
import type {Identity} from './store.ts';
const paths=['api/index.js','vercel.json','package.json','.vercelignore','public/robots.txt'];
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const fail=():never=>{throw new Error('Runtime artifact invalid');};
function bytes(root:string,path:string,limit:number){
 for(const part of [root,...(path.includes('/')?[join(root,path.split('/')[0]!)]:[])]){const stat=lstatSync(part);if(!stat.isDirectory()||stat.isSymbolicLink())fail();}
 const fd=openSync(join(root,path),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>limit)fail();return readFileSync(fd);}finally{closeSync(fd);}
}
function content(root:string,identity:Identity,config:MemberRuntimeConfig){
 const allowed=new Set([...paths,'runtime-manifest.json','api','public']);
 for(const dir of ['', 'api', 'public'])for(const entry of readdirSync(join(root,dir))){const path=dir?dir+'/'+entry:entry;if(!allowed.has(path))fail();}
 const runtime=memberRuntimeIdentity(config);
 if(identity.environment!==config.environment||identity.origin!==config.origin||Object.keys(identity).sort().join(',')!=='environment,epoch,id,origin'||!/^[a-z][a-z0-9_]{0,63}$/.test(identity.id)||!Number.isSafeInteger(identity.epoch)||identity.epoch<1)fail();
 return {profile:'atarasy.runtime-artifact.1',identity:{id:identity.id,environment:identity.environment,origin:identity.origin,epoch:identity.epoch},configFingerprint:runtime.fingerprint,files:paths.map(path=>{const data=bytes(root,path,32*1024*1024);return {path,bytes:data.length,sha256:hash(data)};})};
}
/** Build-time metadata, not a signature or remote attestation. */
export function writeRuntimeManifest(directory:string,identity:Identity,config:MemberRuntimeConfig){
 const root=resolve(directory),value=content(root,identity,config),fingerprint=hash(JSON.stringify(value));
 writeFileSync(join(root,'runtime-manifest.json'),JSON.stringify({...value,fingerprint},null,2)+'\n',{flag:'wx',mode:0o600});return fingerprint;
}
/** Recompute every deployed file instead of trusting the manifest's claimed digest. */
export function verifyRuntimeArtifact(directory:string,identity:Identity,config:MemberRuntimeConfig,expected:string){
 const root=resolve(directory);if(!/^[a-f0-9]{64}$/.test(expected))fail();
 const manifest=JSON.parse(bytes(root,'runtime-manifest.json',65536).toString('utf8'));
 const value=content(root,identity,config),fingerprint=hash(JSON.stringify(value));
 if(!manifest||Object.keys(manifest).sort().join(',')!=='configFingerprint,files,fingerprint,identity,profile'||manifest.fingerprint!==expected||fingerprint!==expected||JSON.stringify(manifest.identity)!==JSON.stringify(value.identity)||manifest.profile!==value.profile||manifest.configFingerprint!==value.configFingerprint||JSON.stringify(manifest.files)!==JSON.stringify(value.files))fail();
 return {fingerprint,configFingerprint:value.configFingerprint};
}
