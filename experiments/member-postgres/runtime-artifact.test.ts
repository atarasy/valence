import {test,expect,afterEach} from 'bun:test';
import {mkdtempSync,rmSync,appendFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeRuntimeManifest,verifyRuntimeArtifact} from './runtime-artifact.ts';
import config from './deployment/config.json';
import {DEPLOYMENT_ID} from './deployment/identity.ts';
import type {MemberRuntimeConfig} from './config.ts';
const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
test('real isolated bundle manifest verifies and changes to code, deployment files or inventory refuse',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'runtime-artifact-test-'));dirs.push(dir);const output=join(dir,'bundle');
 const child=Bun.spawn([process.execPath,new URL('./deployment/build.ts',import.meta.url).pathname,output],{stdout:'pipe',stderr:'pipe'});
 const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect(code).toBe(0);expect(stderr).toBe('');expect(stdout).toContain('Built isolated Vercel artifact:');
 const manifest=await Bun.file(join(output,'runtime-manifest.json')).json();const identity={id:DEPLOYMENT_ID,environment:config.environment,origin:config.origin,epoch:1};
 expect(verifyRuntimeArtifact(output,identity,config as MemberRuntimeConfig,manifest.fingerprint).fingerprint).toBe(manifest.fingerprint);
 expect(()=>verifyRuntimeArtifact(output,{...identity,epoch:2},config as MemberRuntimeConfig,manifest.fingerprint)).toThrow();
 expect(()=>writeRuntimeManifest(output,identity,config as MemberRuntimeConfig)).toThrow();
 for(const path of ['api/index.js','vercel.json','.vercelignore']){const original=await Bun.file(join(output,path)).text();appendFileSync(join(output,path),'changed');expect(()=>verifyRuntimeArtifact(output,identity,config as MemberRuntimeConfig,manifest.fingerprint)).toThrow();writeFileSync(join(output,path),original);}
 writeFileSync(join(output,'api/extra.js'),'extra');expect(()=>verifyRuntimeArtifact(output,identity,config as MemberRuntimeConfig,manifest.fingerprint)).toThrow();rmSync(join(output,'api/extra.js'));
 const original=await Bun.file(join(output,'api/index.js')).text();writeFileSync(join(dir,'outside.js'),original);rmSync(join(output,'api/index.js'));symlinkSync(join(dir,'outside.js'),join(output,'api/index.js'));expect(()=>verifyRuntimeArtifact(output,identity,config as MemberRuntimeConfig,manifest.fingerprint)).toThrow();
});
