import {expect,test} from 'bun:test';
import {readdirSync,readFileSync} from 'node:fs';

// A deployment id written as a literal outlives the id it names: presenter-credential.ts kept
// writing under `atarasy_api_dev` for five days after that id was fenced (2026-09-18).
test('no deployment command names a deployment id except through identity.ts',()=>{
 const dir=new URL('.',import.meta.url).pathname;
 const offenders=readdirSync(dir).filter(f=>f.endsWith('.ts')&&f!=='identity.ts'&&!f.endsWith('.test.ts'))
  .filter(f=>/['"]atarasy_api_(dev|prod)\w*['"]/.test(readFileSync(dir+f,'utf8')));
 expect(offenders).toEqual([]);
});
