import { describe, expect, test } from 'bun:test';
import { sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalConfig, ValenceEngine } from '../src/engine/offers.js';
import { InMemoryLedger } from '../src/engine/ledger.js';
import { openStore } from '../src/common/store.js';
import type { PresenterConfig } from '../src/common/types.js';
import { PHYSICAL, makeEngine, signConfig, PRESENTER_PAIR } from './helpers.js';
const config=():PresenterConfig=>({version:'catalogue-v2-fixture',presenter:'merchant-1',products:{tea:{merchant:'maker-a',maker:'maker',ships:'carrier',price:1200,physical:{...PHYSICAL}}}});
const create=(version:string)=>({binding:'physical' as const,household:'fixture-v2-house',purpose:'replenish' as const,config_version:version,expires_at:Date.now()+3600000,mandate:'mandate-1',price_band:null,giver:null,candidates:[{product:'tea',quantity:1,predicted_conversion:0.5,is_exploration:true,given_by:null}]});
const options={explorationRate:0.2,reminderLimit:1 as const,recoveryGraceDays:3,relyingPartyId:'unit.example'};
const legacy=(c:PresenterConfig)=>Buffer.from([c.version,c.presenter,...Object.keys(c.products).sort().map(ref=>{const e=c.products[ref]!;return [ref,e.merchant,e.maker,e.ships,String(e.price),e.category??''].map(encodeURIComponent).join(':');})].join('\n'));
describe('catalogue signature revision 2',()=>{
 test('every physical field and metadata presence is bound to the signature',()=>{
  const original=config();const signature=signConfig(original);
  for(const patch of [{ambient:false},{keeps_for_days:364},{fits_ten_per_container:false},{regulated:true}]){
   const altered=structuredClone(original);Object.assign(altered.products.tea!.physical!,patch);
   const {engine}=makeEngine();expect(()=>engine.registerConfig(altered,signature)).toThrow(/not signed by/);
  }
  const absent=structuredClone(original);delete absent.products.tea!.physical;
  expect(()=>makeEngine().engine.registerConfig(absent,signature)).toThrow(/not signed by/);
  expect(()=>makeEngine().engine.registerConfig(original,signConfig(absent))).toThrow(/not signed by/);
  expect(makeEngine().engine.registerConfig(original,signature)).toEqual(original);
 });
 test('old signatures are not a fallback even for catalogues without physical metadata',()=>{
  for(const physical of [true,false]){const c=config();if(!physical)delete c.products.tea!.physical;const old=sign(null,legacy(c),PRESENTER_PAIR.privateKey).toString('base64');expect(()=>makeEngine().engine.registerConfig(c,old)).toThrow(/not signed by/);}
 });
 test('unknown fields malformed booleans unsafe integers and unpaired surrogates are rejected',()=>{
  const cases:any[]=[{...config(),extra:true},{...config(),presenter:'\uD800'}];
  for(const patch of [{price:9007199254740992},{physical:{...PHYSICAL,ambient:1}},{physical:{...PHYSICAL,keeps_for_days:-1}},{physical:{...PHYSICAL,extra:true}},{category:''},{extra:true}]){const c=config();Object.assign(c.products.tea!,patch);cases.push(c);}
  for(const c of cases)expect(()=>canonicalConfig(c)).toThrow();
 });
 test('input return and export mutation cannot rewrite a verified catalogue',()=>{
  const {engine}=makeEngine();const c=config();const returned=engine.registerConfig(c,signConfig(c));
  c.products.tea!.price=1;c.products.tea!.physical!.ambient=false;
  returned.products.tea!.price=2;returned.products.tea!.physical!.ambient=false;
  const exported=engine.configsForPresenter('merchant-1').find(x=>x.version===c.version)!;
  expect(Object.keys(exported).sort()).toEqual(['presenter','products','version']);exported.products.tea!.price=3;exported.products.tea!.physical!.ambient=false;
  const offer=engine.createOffer(create(c.version));expect(offer.candidates[0]!.unit_price).toBe(1200);
 });
 test('verified revision survives a persistent store reopen',()=>{
  const dir=mkdtempSync(join(tmpdir(),'catalogue-v2-'));const path=join(dir,'store.sqlite');
  try {const store=openStore(path);const first=new ValenceEngine(new InMemoryLedger(),options,store);const c=config();first.registerIdentity(c.presenter,PRESENTER_PAIR.publicKey.export({type:'spki',format:'pem'}).toString(),true);first.registerConfig(c,signConfig(c));store.close();
   const restored=openStore(path);try {const second=new ValenceEngine(new InMemoryLedger(),options,restored);expect(second.createOffer(create(c.version)).candidates[0]!.unit_price).toBe(1200);}finally{restored.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 test('unmarked legacy rows stay exportable but require republication before a new offer',()=>{
  const dir=mkdtempSync(join(tmpdir(),'catalogue-legacy-'));const path=join(dir,'store.sqlite');
  try {const c=config();const legacyStore=openStore(path);legacyStore.map<PresenterConfig>('configs').set(c.version,c);legacyStore.close();
   const store=openStore(path);try{const engine=new ValenceEngine(new InMemoryLedger(),options,store);expect(engine.configsForPresenter(c.presenter)).toEqual([c]);expect(()=>engine.createOffer(create(c.version))).toThrow(/republish/);
    engine.registerIdentity(c.presenter,PRESENTER_PAIR.publicKey.export({type:'spki',format:'pem'}).toString(),true);const revised={...c,version:'republished-v2'};engine.registerConfig(revised,signConfig(revised));expect(engine.createOffer(create(revised.version)).config_version).toBe(revised.version);
   }finally{store.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});

test('independent Python vectors match exact UTF-8 bytes and digest',async()=>{
 const vectors=await Bun.file(new URL('./fixtures/catalogue-v2-vectors.json',import.meta.url)).json();
 const {createHash}=await import('node:crypto');expect(vectors.length).toBe(10);
 for(const v of vectors){const actual=canonicalConfig(v.config);expect(actual.toString('utf8')).toBe(v.canonical);expect(createHash('sha256').update(actual).digest('hex')).toBe(v.sha256);}
});

test('HTTP publication rejects altered eligibility legacy signatures and caller trust flags',async()=>{
 const {createApp}=await import('../src/http.js');
 const {ApprovalDesk}=await import('../src/hub/approval.js');
 const {RecoveryRegister}=await import('../src/hub/node.js');
 const {PermissionLedger}=await import('../src/hub/permissions.js');
 const {Registry}=await import('../src/shared/registry.js');
 const {engine,deliveries}=makeEngine();const handle=createApp(engine,{deliveries,approvals:new ApprovalDesk(),recovery:new RecoveryRegister(),permissions:new PermissionLedger(),registry:new Registry()});
 const c=config(),signature=signConfig(c);
 const request=async(body:unknown)=>handle(new Request('https://unit.example/_presenter/configs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 for(const patch of [{ambient:false},{keeps_for_days:364},{fits_ten_per_container:false},{regulated:true}]){
  const altered=structuredClone(c);Object.assign(altered.products.tea!.physical!,patch);const r=await request({...altered,signature});expect(r.status).toBe(422);expect((await r.json()).error).toBe('bad_signature');
 }
 const old=sign(null,legacy(c),PRESENTER_PAIR.privateKey).toString('base64');const legacyResult=await request({...c,signature:old});expect(legacyResult.status).toBe(422);expect((await legacyResult.json()).error).toBe('bad_signature');
 const injected=await request({...c,signature,__catalogueSignatureFormat:2});expect(injected.status).toBe(400);expect((await injected.json()).error).toBe('malformed');
 const good=await request({...c,signature});expect(good.status).toBe(201);expect(await good.json()).toEqual(c);
});

test('product references are own catalogue entries, including reserved JavaScript names',async()=>{
 const {engine}=makeEngine();const c=config();engine.registerConfig(c,signConfig(c));
 for(const product of ['constructor','toString','__proto__'])expect(()=>engine.createOffer({...create(c.version),binding:'digital',candidates:[{product,quantity:1,predicted_conversion:0.5,is_exploration:true,given_by:null}]})).toThrow(/no product/);
});

test('HTTP preserves a signed reserved-name product reference',async()=>{
 const c=config();
 const {createApp}=await import('../src/http.js');const {ApprovalDesk}=await import('../src/hub/approval.js');const {RecoveryRegister}=await import('../src/hub/node.js');const {PermissionLedger}=await import('../src/hub/permissions.js');const {Registry}=await import('../src/shared/registry.js');const made=makeEngine();
 const handle=createApp(made.engine,{deliveries:made.deliveries,approvals:new ApprovalDesk(),recovery:new RecoveryRegister(),permissions:new PermissionLedger(),registry:new Registry()});
 const reserved={...c,version:'reserved-key',products:{['__proto__']:c.products.tea!}};
 const r=await handle(new Request('https://unit.example/_presenter/configs',{method:'POST',body:JSON.stringify({...reserved,signature:signConfig(reserved)})}));expect(r.status).toBe(201);expect(await r.json()).toEqual(reserved);
});
