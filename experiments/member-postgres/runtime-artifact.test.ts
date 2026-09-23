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
test('each target bundles only its own origin and app identifier, and its manifest names its own deployment',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'runtime-artifact-targets-'));dirs.push(dir);
 const build=async(args:string[])=>{const child=Bun.spawn([process.execPath,new URL('./deployment/build.ts',import.meta.url).pathname,...args],{stdout:'pipe',stderr:'pipe'});const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {stdout,stderr,code};};
 const dev=join(dir,'development'),prod=join(dir,'production');
 expect(await build([dev])).toMatchObject({code:0,stderr:''});
 const built=await build(['--target','production',prod]);expect(built).toMatchObject({code:0,stderr:''});expect(built.stdout).toContain('(production, https://members.vox.delivery)');
 const devJS=await Bun.file(join(dev,'api/index.js')).text(),prodJS=await Bun.file(join(prod,'api/index.js')).text();
 expect(devJS).toContain('83W4J65UE6.dev.atarasy.prototype');expect(devJS).toContain('https://api-dev.vox.delivery');
 expect(devJS).not.toContain('83W4J65UE6.com.vox.atarasy');expect(devJS).not.toContain('members.vox.delivery');
 expect(prodJS).toContain('83W4J65UE6.com.vox.atarasy');expect(prodJS).toContain('https://members.vox.delivery');expect(prodJS).toContain('atarasy_api_prod');
 expect(prodJS).not.toContain('dev.atarasy.prototype');expect(prodJS).not.toContain('api-dev.vox.delivery');expect(prodJS).not.toContain(DEPLOYMENT_ID);
 expect(await Bun.file(join(prod,'package.json')).json()).toMatchObject({name:'atarasy-api'});
 const manifest=await Bun.file(join(prod,'runtime-manifest.json')).json();
 expect(manifest.identity).toEqual({id:'atarasy_api_prod',environment:'production',origin:'https://members.vox.delivery',epoch:1});
 const production=(await import('./deployment/production/config.json')).default as MemberRuntimeConfig;
 expect(verifyRuntimeArtifact(prod,manifest.identity,production,manifest.fingerprint).fingerprint).toBe(manifest.fingerprint);
 // A development bundle does not verify as production.
 const devManifest=await Bun.file(join(dev,'runtime-manifest.json')).json();
 expect(()=>verifyRuntimeArtifact(dev,manifest.identity,production,devManifest.fingerprint)).toThrow();
 // An existing output directory and an unknown target are refused.
 expect((await build(['--target','production',prod])).code).not.toBe(0);
 expect((await build(['--target','staging',join(dir,'staging')])).code).not.toBe(0);
},60000);
