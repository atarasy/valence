import {writeRuntimeManifest} from '../runtime-artifact.ts';
import {parseTarget} from './targets.ts';
import { mkdir,copyFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// `bun deployment/build.ts [--target development|production] <new dir>`; development when omitted.
const {target,rest}=parseTarget(process.argv.slice(2));
const destination=rest[0];if(!destination||rest.length!==1)throw new Error('Usage: build.ts [--target development|production] <explicit new isolated output directory>');
await mkdir(resolve(destination));
await mkdir(resolve(destination,'api'));
await mkdir(resolve(destination,'public'),{recursive:true});
await writeFile(resolve(destination,'public/robots.txt'),'User-agent: *\nDisallow: /\n');
const built=await Bun.build({entrypoints:[target.entry],target:'bun',format:'esm',packages:'bundle',outdir:resolve(destination,'api'),naming:'index.js'});
if(!built.success)throw new Error(built.logs.map(String).join('\n'));
await copyFile(new URL('./vercel.json',import.meta.url),resolve(destination,'vercel.json'));
await writeFile(resolve(destination,'package.json'),JSON.stringify({name:target.packageName,private:true,type:'module',scripts:{build:'echo Prebundled member API'}},null,2)+'\n');
await writeFile(resolve(destination,'.vercelignore'),'.env*\n.agents\n.claude\n');
const fingerprint=writeRuntimeManifest(destination,{id:target.deploymentID,environment:target.config.environment,origin:target.config.origin,epoch:1},target.config);
console.log(`Built isolated Vercel artifact: ${fingerprint} (${target.name}, ${target.config.origin})`);
