import { beforeAll, afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { createPool,initialiseDeployment,postgresStore,type Identity } from './store.ts';
import { migrateDatabase } from './migrate.ts';
import { seedAtomicFixture,settleFixture,inspectFixture } from '../member-transactions/atomic-fixture.ts';
const url=process.env.ATARASY_TEST_POSTGRES_URL;
if(!url)throw new Error('Explicit ATARASY_TEST_POSTGRES_URL required; tests do not use application credentials');
const pool=createPool(url),ids:string[]=[];
beforeAll(async()=>{await migrateDatabase(url);await migrateDatabase(url);});
afterAll(async()=>{for(const id of ids){await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id]);}await pool.end();});
async function setup(){const identity:Identity={id:'test_'+randomUUID().replaceAll('-',''),environment:'test',origin:'https://unit.example',epoch:1};ids.push(identity.id);await initialiseDeployment(pool,identity);return {identity,unit:postgresStore(pool,identity)};}
async function fixture(count=1,ceiling:number|null=null){
 const s=await setup(),dir=mkdtempSync(join(tmpdir(),'postgres-engine-')),path=join(dir,'fixture.sqlite');
 try {const statements=await seedAtomicFixture(path,count,ceiling);const db=new Database(path,{readonly:true});
 try{const rows=db.query('SELECT namespace,k,v FROM atomic_rows ORDER BY rowid').all() as {namespace:string;k:string;v:string}[];
 await s.unit.run(store=>{const maps=new Map<string,Map<string,unknown>>();for(const r of rows){let map=maps.get(r.namespace);if(!map){map=store.map(r.namespace);maps.set(r.namespace,map);}map.set(r.k,JSON.parse(r.v));}});
 }finally{db.close();}return {...s,statements};}finally{rmSync(dir,{recursive:true,force:true});}
}
test('actual engine settlement persists receipt and ledger across independent connections',async()=>{
 const s=await fixture();await s.unit.run(store=>settleFixture(store,s.statements[0]!));
 const independent=createPool(url!);try{const state=await postgresStore(independent,s.identity).run(store=>inspectFixture(store,s.statements[0]!.offer));expect(state.receipt).not.toBeNull();expect(state.state).toBe('settled');}finally{await independent.end();}
});
test('competing offers cannot both consume one shared daily allowance',async()=>{
 const s=await fixture(2,2000),other=createPool(url!);
 try{const result=await Promise.allSettled([s.unit.run(store=>settleFixture(store,s.statements[0]!)),postgresStore(other,s.identity).run(store=>settleFixture(store,s.statements[1]!))]);expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(result.filter(x=>x.status==='rejected')).toHaveLength(1);
 const states=[];for(const statement of s.statements)states.push(await s.unit.run(store=>inspectFixture(store,statement.offer)));expect(states.filter(s=>s.receipt!==null)).toHaveLength(1);
 }finally{await other.end();}
});
test('exception after real settlement rolls back every staged engine effect',async()=>{
 const s=await fixture(),before=await s.unit.run(store=>inspectFixture(store,s.statements[0]!.offer));
 await expect(s.unit.run(async store=>{await settleFixture(store,s.statements[0]!);throw new Error('injected after settlement');})).rejects.toThrow('injected');
 expect(await s.unit.run(store=>inspectFixture(store,s.statements[0]!.offer))).toEqual(before);
});
test('set-time bytes order scope lifetime and uncloneable outputs retain reference semantics',async()=>{
 const s=await setup();let escaped:Map<string,{n:number}>;let next:()=>IteratorResult<[string,{n:number}]>;
 await s.unit.run(store=>{escaped=store.map('sample');const value={n:1};escaped.set('b',value);escaped.set('a',{n:2});value.n=9;next=escaped.entries().next.bind(escaped.entries());});
 expect(()=>escaped!.get('b')).toThrow('scope ended');expect(()=>next!()).toThrow('scope ended');
 expect(await s.unit.run(store=>[...store.map('sample')])).toEqual([['b',{n:1}],['a',{n:2}]]);
 await expect(s.unit.run(store=>{store.map('sample').set('c',3);return ()=>{};})).rejects.toThrow();
 expect(await s.unit.run(store=>[...store.map('sample').keys()])).toEqual(['b','a']);
 await s.unit.run(store=>{const m=store.map('sample');m.delete('b');m.set('b',{n:3});});
 expect(await s.unit.run(store=>[...store.map('sample').keys()])).toEqual(['a','b']);
});
test('identity mismatch disabled writer and stale epoch refuse before work',async()=>{
 const s=await setup();let called=false;
 await expect(postgresStore(pool,{...s.identity,origin:'https://foreign.example'}).run(()=>{called=true;})).rejects.toThrow('fenced');
 await pool.query('UPDATE atarasy_member.control SET epoch=2 WHERE id=$1',[s.identity.id]);
 await expect(s.unit.run(()=>{called=true;})).rejects.toThrow('fenced');
 await expect(initialiseDeployment(pool,s.identity)).rejects.toThrow('fenced');
 await pool.query('UPDATE atarasy_member.control SET enabled=false WHERE id=$1',[s.identity.id]);
 await expect(postgresStore(pool,{...s.identity,epoch:2}).run(()=>{called=true;})).rejects.toThrow('fenced');expect(called).toBe(false);
});
test('control lock delays a competing callback until the earlier transaction commits',async()=>{
 const s=await setup(),other=createPool(url!);let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});let secondEntered=false;
 const first=s.unit.run(async store=>{store.map('lock_probe').set('first',1);entered();await gate;});await started;
 const second=postgresStore(other,s.identity).run(store=>{secondEntered=true;return store.map('lock_probe').get('first');});
 try{await Bun.sleep(75);expect(secondEntered).toBe(false);}finally{release();await first;}
 try{expect(await second).toBe(1);}finally{await other.end();}
});
