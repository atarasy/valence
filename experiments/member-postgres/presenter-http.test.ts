import {afterAll,beforeAll,expect,test} from 'bun:test';
import {generateKeyPairSync,randomUUID,sign,type KeyObject} from 'node:crypto';
import {createPool,initialiseDeployment,postgresStore,type Identity} from './store.ts';
import {migrateDatabase} from './migrate.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {memberRuntime} from './runtime.ts';
import {registerPresenter} from './presenter-http.ts';
import {canonicalConfig} from '../../engine/src/engine/offers.ts';
import {canonicalMandate} from '../../engine/src/hub/mandates.ts';
import {houseOf,mandateOf} from '../member-transactions/atomic-fixture.ts';
import {canonicalDisclosure} from '../../engine/src/shared/disclosure.ts';
import type {MemberRuntimeConfig} from './config.ts';
const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Explicit isolated ATARASY_TEST_POSTGRES_URL required');
const pool=createPool(url),ids:string[]=[];
const config:MemberRuntimeConfig={environment:'test',origin:'https://unit.example',rpID:'unit.example',explorationRate:0.2,reminderLimit:1,recoveryGraceDays:3,dayBoundary:'UTC',maximumLifetimeMs:60000,maxSessionLifetimeMs:100000,maximumBodyBytes:20000,bodyTimeoutMs:1000,maximumPending:8,budgetWindowMs:60000,maximumRequests:500,maximumTrackedTokens:100};
beforeAll(()=>migrateDatabase(url));
afterAll(async()=>{for(const id of ids){await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id]);}await pool.end();});
const pem=(pair:{publicKey:KeyObject})=>pair.publicKey.export({type:'spki',format:'pem'}).toString();
// §13.2, question 55. The household's identifier is the name of its own key
// and its mandate's is that identifier with a label, so both are derived here
// rather than written as `house` and `mandate-1`.
const HOUSEHOLD_PAIR=generateKeyPairSync('ed25519'),HOUSE=houseOf(HOUSEHOLD_PAIR),MANDATE=mandateOf(HOUSEHOLD_PAIR);
function shop(name:string){
 const presenter={id:'presenter-'+name,pair:generateKeyPairSync('ed25519')},merchant={id:'merchant-'+name,pair:generateKeyPairSync('ed25519')};
 const catalogue=(version:string,named=presenter.id)=>{
  const body={version,presenter:named,products:{['tea-'+name]:{merchant:merchant.id,maker:'maker-'+name,ships:'carrier-'+name,price:1200,physical:{ambient:true,keeps_for_days:365,fits_ten_per_container:true,regulated:false}}}};
  return {...body,signature:sign(null,canonicalConfig(body),presenter.pair.privateKey).toString('base64')};
 };
 const disclosure=(forMerchant=merchant.id)=>{
  const body={merchant:forMerchant,product:null,version:'d-1',items:[{label:'notice',value:'test'}]};
  return {...body,signature:sign(null,canonicalDisclosure(body),merchant.pair.privateKey).toString('base64')};
 };
 return {presenter,merchant,catalogue,disclosure};
}
async function setup(){
 const identity:Identity={id:'presenter_'+randomUUID().replaceAll('-',''),environment:'test',origin:config.origin,epoch:1};ids.push(identity.id);await initialiseDeployment(pool,identity);
 const app=await openPostgresMemberHTTP(pool,identity,config),unit=postgresStore(pool,identity);
 const a=shop('a'),b=shop('b');
 // §16.1, question 56. An import writes a claim now, which no offer can name,
 // so the fixture signs its own mandate with the household's key.
 await unit.run(store=>{const e=memberRuntime(store,config).engine;
  e.registerIdentity(HOUSE,HOUSEHOLD_PAIR.publicKey.export({type:'spki',format:'pem'}).toString());
  const mandate={id:MANDATE,household:HOUSE,ceiling_out_of_network:10000,ceiling_daily:null,cooling_seconds:null,co_signers:[],lapses_at:Date.now()+86_400_000*7,version:1};
  e.mandates.record({mandate,signatures:{[HOUSE]:sign(null,canonicalMandate(mandate,config.rpID),HOUSEHOLD_PAIR.privateKey).toString('base64')},assertions:{},keyOf:(k:string)=>e.publicKeyFor(k),relyingPartyId:config.rpID});});
 // One registration per unit, as the operator command does: a unit opens each record namespace once.
 const register=(s:ReturnType<typeof shop>)=>unit.run(store=>registerPresenter(memberRuntime(store,config),{presenter:s.presenter.id,presenterKey:pem(s.presenter.pair),merchant:s.merchant.id,merchantKey:pem(s.merchant.pair),at:Date.now()}).token);
 const tokenA=await register(a),tokenB=await register(b);
 const send=(token:string,path:string,body?:unknown)=>app.fetch(new Request(config.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},...(body===undefined?{}:{body:JSON.stringify(body)})}),{peer:'presenter-test'});
 const offerBody=(version:string,product:string)=>({binding:'physical',household:HOUSE,purpose:'replenish',config_version:version,expires_at:Date.now()+86_400_000,mandate:MANDATE,price_band:null,giver:null,candidates:[{product,quantity:1,predicted_conversion:0.5,is_exploration:true,given_by:null}]});
 return {unit,a,b,tokenA:tokenA!,tokenB:tokenB!,send,offerBody};
}
test('a presenter credential publishes, presents, delivers and collects only its own box',async()=>{
 const s=await setup();
 expect(await (await s.send(s.tokenA,'/presenter/self')).json()).toEqual({presenter:s.a.presenter.id});
 expect((await s.send('apr1_'+'x'.repeat(43),'/presenter/self')).status).toBe(401);
 expect((await s.send(s.tokenB,'/presenter/configs',s.a.catalogue('a-1'))).status).toBe(403);
 expect((await s.send(s.tokenA,'/presenter/configs',s.a.catalogue('a-1'))).status).toBe(201);
 const listed=await (await s.send(s.tokenA,'/presenter/configs')).json() as {configs:{version:string;presenter:string;products:Record<string,unknown>}[]};
 expect(listed.configs.map(c=>[c.version,c.presenter,Object.keys(c.products)])).toEqual([['a-1',s.a.presenter.id,['tea-a']]]);
 expect(await (await s.send(s.tokenB,'/presenter/configs')).json()).toEqual({configs:[]});
 expect((await s.send(s.tokenB,'/presenter/disclosures',s.a.disclosure())).status).toBe(403);
 expect((await s.send(s.tokenA,'/presenter/disclosures',s.a.disclosure())).status).toBe(201);
 expect((await s.send(s.tokenB,'/presenter/offers',s.offerBody('a-1','tea-a'))).status).toBe(403);
 const created=await s.send(s.tokenA,'/presenter/offers',s.offerBody('a-1','tea-a'));expect(created.status).toBe(201);
 const offer=await created.json() as {id:string;candidates:{id:string}[]};
 expect(await s.unit.run(store=>memberRuntime(store,config).authority.ownerOf({kind:'offer',id:offer.id}))).toEqual({household:HOUSE,presenter:s.a.presenter.id});
 // Another presenter's offer answers exactly like one that does not exist.
 for(const path of ['/presenter/offers/'+offer.id,'/presenter/offers/'+randomUUID()])expect(await (await s.send(s.tokenB,path)).json()).toMatchObject({error:'offer_unavailable'});
 expect((await s.send(s.tokenB,'/presenter/offers/'+offer.id+'/recovery',{returned:[],consumed:[]})).status).toBe(404);
 expect((await s.send(s.tokenA,'/presenter/offers/'+offer.id+'/present',{})).status).toBe(200);
 expect(await (await s.send(s.tokenA,'/presenter/offers/'+offer.id+'/recovery',{returned:[],consumed:[offer.candidates[0]!.id]})).json()).toMatchObject({error:'delivery_missing'});
 const delivered=await s.send(s.tokenA,'/presenter/offers/'+offer.id+'/delivery',{carriage:550,status:'delivered'});
 expect(delivered.status).toBe(201);expect(await delivered.json()).toEqual({offer:offer.id,carriage:550,status:'delivered'});
 expect(await (await s.send(s.tokenA,'/presenter/offers/'+offer.id+'/recovery',{returned:[],consumed:['stranger']})).json()).toMatchObject({error:'unknown_candidate'});
 const candidate=offer.candidates[0]!.id;
 expect((await s.send(s.tokenA,'/presenter/offers/'+offer.id+'/recovery',{returned:[],consumed:[candidate]})).status).toBe(200);
 expect(await (await s.send(s.tokenA,'/presenter/offers/'+offer.id+'/recovery',{returned:[],consumed:[candidate]})).json()).toMatchObject({error:'already_collected'});
 const read=await s.send(s.tokenA,'/presenter/offers/'+offer.id),text=await read.text();
 expect(read.status).toBe(200);expect(text).not.toContain('dev-');
 expect(JSON.parse(text)).toMatchObject({offer:{id:offer.id,state:'decided'},delivery:{carriage:550,status:'delivered'},recovery:{consumed:[candidate]},settlement:null});
 expect((await (await s.send(s.tokenA,'/presenter/offers?household='+encodeURIComponent(HOUSE))).json()).offers.map((o:{id:string})=>o.id)).toEqual([offer.id]);
 expect((await (await s.send(s.tokenB,'/presenter/offers?household='+encodeURIComponent(HOUSE))).json()).offers).toEqual([]);
});
test('a collection must name every undecided item, so the box can always settle',async()=>{
 const s=await setup(),physical={ambient:true,keeps_for_days:365,fits_ten_per_container:true,regulated:false};
 const body={version:'b-2',presenter:s.b.presenter.id,products:{'tea-b':{merchant:s.b.merchant.id,maker:'maker-b',ships:'carrier-b',price:1200,physical},'rice-b':{merchant:s.b.merchant.id,maker:'maker-b',ships:'carrier-b',price:900,physical}}};
 expect((await s.send(s.tokenB,'/presenter/configs',{...body,signature:sign(null,canonicalConfig(body),s.b.presenter.pair.privateKey).toString('base64')})).status).toBe(201);
 expect((await s.send(s.tokenB,'/presenter/disclosures',s.b.disclosure())).status).toBe(201);
 const both=s.offerBody('b-2','tea-b');both.candidates.push({...both.candidates[0]!,product:'rice-b'});
 const offer=await (await s.send(s.tokenB,'/presenter/offers',both)).json() as {id:string;candidates:{id:string;product:string}[]};
 expect((await s.send(s.tokenB,'/presenter/offers/'+offer.id+'/present',{})).status).toBe(200);
 expect((await s.send(s.tokenB,'/presenter/offers/'+offer.id+'/delivery',{carriage:550,status:'delivered'})).status).toBe(201);
 const [tea,rice]=offer.candidates.map(c=>c.id) as [string,string];
 expect(await (await s.send(s.tokenB,'/presenter/offers/'+offer.id+'/recovery',{returned:[],consumed:[tea]})).json()).toMatchObject({error:'collection_incomplete'});
 expect((await (await s.send(s.tokenB,'/presenter/offers/'+offer.id)).json()).recovery.collected_at).toBeNull();
 const collected=await s.send(s.tokenB,'/presenter/offers/'+offer.id+'/recovery',{returned:[rice],consumed:[tea]});
 expect(collected.status).toBe(200);
 expect((await (await s.send(s.tokenB,'/presenter/offers/'+offer.id)).json()).offer.state).toBe('decided');
});
test('a digital offer accepts neither a delivery nor a collection',async()=>{
 const s=await setup();
 expect((await s.send(s.tokenB,'/presenter/configs',s.b.catalogue('b-1'))).status).toBe(201);
 expect((await s.send(s.tokenB,'/presenter/disclosures',s.b.disclosure())).status).toBe(201);
 const created=await s.send(s.tokenB,'/presenter/offers',{...s.offerBody('b-1','tea-b'),binding:'digital'});expect(created.status).toBe(201);
 const offer=await created.json() as {id:string;candidates:{id:string}[]};
 expect(await (await s.send(s.tokenB,'/presenter/offers/'+offer.id+'/delivery',{carriage:550,status:'delivered'})).json()).toMatchObject({error:'not_physical'});
 expect(await (await s.send(s.tokenB,'/presenter/offers/'+offer.id+'/recovery',{returned:[],consumed:[offer.candidates[0]!.id]})).json()).toMatchObject({error:'not_physical'});
 expect((await (await s.send(s.tokenB,'/presenter/offers/'+offer.id)).json()).delivery).toBeNull();
});
test('presenter routes refuse member tokens and member routes refuse presenter tokens',async()=>{
 const s=await setup();
 expect((await s.send('amr1_'+'x'.repeat(43),'/presenter/self')).status).toBe(401);
 expect((await s.send(s.tokenA,'/auth/session')).status).toBe(401);
 expect((await s.send(s.tokenA,'/presenter/identities',{})).status).toBe(404);
});

test('digital quotation is scoped, immutable, replayable and never a delivery',async()=>{
 const s=await setup();
 await s.send(s.tokenB,'/presenter/configs',s.b.catalogue('quote-1'));
 await s.send(s.tokenB,'/presenter/disclosures',s.b.disclosure());
 const create=async(binding='digital')=>(await (await s.send(s.tokenB,'/presenter/offers',{...s.offerBody('quote-1','tea-b'),binding})).json()) as {id:string};
 const offer=await create(),path='/presenter/offers/'+offer.id+'/carriage-quote';
 expect((await s.send(s.tokenA,path,{carriage:550})).status).toBe(404);
 expect((await s.send('amr1_'+'x'.repeat(43),path,{carriage:550})).status).toBe(401);
 for(const carriage of [-1,0.5,Number.MAX_SAFE_INTEGER+1,'550',null])expect((await s.send(s.tokenB,path,{carriage})).status).toBe(422);
 for(const extra of [{status:'placed'},{code:'address-resolving-code'},{presenter:s.a.presenter.id}])expect((await s.send(s.tokenB,path,{carriage:550,...extra})).status).toBe(400);
 expect((await s.send(s.tokenB,path+'?override=true',{carriage:550})).status).toBe(400);
 const results=await Promise.all([s.send(s.tokenB,path,{carriage:550}),s.send(s.tokenB,path,{carriage:550})]);
 expect(results.map(r=>r.status).sort()).toEqual([200,201]);
 const saved=await results[0]!.json();expect(await results[1]!.json()).toEqual(saved);
 expect(saved).toMatchObject({offer:offer.id,carriage:550});expect(Object.keys(saved).sort()).toEqual(['carriage','offer','quoted_at']);
 expect((await s.send(s.tokenB,path,{carriage:551})).status).toBe(422);
 const detail=await (await s.send(s.tokenB,'/presenter/offers/'+offer.id)).json();
 expect(detail.delivery).toBeNull();expect(detail.carriage_quote).toEqual(saved);
 expect((await s.send(s.tokenB,'/presenter/offers/'+offer.id+'/delivery',{carriage:550,status:'delivered'})).status).toBe(422);
 const physical=await create('physical');expect((await s.send(s.tokenB,'/presenter/offers/'+physical.id+'/carriage-quote',{carriage:550})).status).toBe(422);
 const zero=await create();expect((await s.send(s.tokenB,'/presenter/offers/'+zero.id+'/carriage-quote',{carriage:0})).status).toBe(201);
 const expired=await create();
 await s.unit.run(store=>{const rows=store.map<any>('offers'),row=rows.get(expired.id);row.expires_at=1;rows.set(expired.id,row);});
 expect((await s.send(s.tokenB,'/presenter/offers/'+expired.id+'/carriage-quote',{carriage:500})).status).toBe(409);
});
