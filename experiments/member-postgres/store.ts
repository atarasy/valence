import { Pool } from 'pg';
import type { Store } from '../../engine/src/common/store.ts';
export type Identity = { id:string; environment:string; origin:string; epoch:number };
const savepoints=new WeakMap<Store,<T>(fn:()=>T)=>T>();
export function storeSavepoint<T>(store:Store,fn:()=>T):T {const save=savepoints.get(store);if(!save)throw new Error('Unknown PostgreSQL capability');return save(fn);}
type Row = {namespace:string; key:string; value:string};
const validName = (s:string) => typeof s==='string' && /^[a-z][a-z0-9_]{0,63}$/.test(s);
function identity(input:Identity) {
 const p=Object.freeze(structuredClone(input));
 if(Object.keys(p).sort().join(',')!=='environment,epoch,id,origin'||!validName(p.id)||!validName(p.environment)||!Number.isSafeInteger(p.epoch)||p.epoch<1||new URL(p.origin).origin!==p.origin||new URL(p.origin).protocol!=='https:')throw new Error('Invalid PostgreSQL identity');
 return p;
}
export function createPool(connectionString:string) {
 // Pin certificate and hostname verification for Neon, including future pg releases.
 const url=new URL(connectionString);
 if(url.hostname.endsWith('.neon.tech')){url.searchParams.set('sslmode','verify-full');url.searchParams.delete('uselibpqcompat');}
 return new Pool({connectionString:url.toString(),max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:5000, idle_in_transaction_session_timeout:10000});
}
/** Explicit trusted bootstrap after migration; never an HTTP operation. */
export async function initialiseDeployment(pool:Pool,input:Identity) {
 const p=identity(input),c=await pool.connect();
 try {
  await c.query('BEGIN');
  await c.query('INSERT INTO atarasy_member.control VALUES ($1,$2,$3,$4,true) ON CONFLICT (id) DO NOTHING',[p.id,p.environment,p.origin,p.epoch]);
  const {rows}=await c.query('SELECT environment,origin,epoch,enabled FROM atarasy_member.control WHERE id=$1 FOR UPDATE',[p.id]);
  const r=rows[0];if(!r||r.environment!==p.environment||r.origin!==p.origin||r.epoch!==p.epoch||!r.enabled)throw new Error('PostgreSQL writer fenced');
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
/** Development foundation: one database lock covers every engine aggregate in a deployment. */
export function postgresStore(pool:Pool,input:Identity) {
 const p=identity(input);
 return {
  async run<T>(work:(store:Store)=>Promise<T>|T):Promise<T> {
   const c=await pool.connect();let active=false,broken=false;
   const check=()=>{if(!active)throw new Error('PostgreSQL scope ended');};
   try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout='5s'");
    await c.query("SET LOCAL statement_timeout='5s'");
    await c.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
    const {rows:controls}=await c.query('SELECT environment,origin,epoch,enabled FROM atarasy_member.control WHERE id=$1 FOR UPDATE',[p.id]);
    const control=controls[0];
    if(!control||control.environment!==p.environment||control.origin!==p.origin||control.epoch!==p.epoch||!control.enabled)throw new Error('PostgreSQL writer fenced');
    const bounds=await c.query('SELECT count(*)::int AS n,coalesce(sum(octet_length(value)),0)::text AS bytes FROM atarasy_member.engine_rows WHERE deployment=$1',[p.id]);
    if(bounds.rows[0].n>10000||Number(bounds.rows[0].bytes)>16_777_216)throw new Error('PostgreSQL snapshot limit');
    const {rows}=await c.query<Row>('SELECT namespace,key,value FROM atarasy_member.engine_rows WHERE deployment=$1 ORDER BY ordinal',[p.id]);
    const snapshots=new Map<string,Map<string,string>>();
    for(const r of rows){let map=snapshots.get(r.namespace);if(!map){map=new Map();snapshots.set(r.namespace,map);}map.set(r.key,r.value);}
    const liveMaps:Map<string,unknown>[]=[];
    const used=new Set<string>(),operations:({kind:'set';namespace:string;key:string;value:string}|{kind:'delete';namespace:string;key:string}|{kind:'clear';namespace:string})[]=[];
    active=true;
    const store:Store={
     map<V>(namespace:string):Map<string,V> {
      check();if(!validName(namespace)||used.has(namespace))throw new Error('Invalid or duplicate PostgreSQL map');used.add(namespace);
      const map=new Map<string,V>();for(const [key,value]of snapshots.get(namespace)??[])map.set(key,JSON.parse(value));
      liveMaps.push(map);
      let proxy:Map<string,V>;
      proxy=new Proxy(map,{get(target,property){
       check();
       if(property==='set')return (key:string,value:V)=>{check();const encoded=JSON.stringify(value);if(typeof key!=='string'||encoded===undefined||Buffer.byteLength(encoded)>1_048_576)throw new Error('Invalid PostgreSQL value');if(operations.length>=10000)throw new Error('PostgreSQL write limit');operations.push({kind:'set',namespace,key,value:encoded});target.set(key,value);return proxy;};
       if(property==='delete')return (key:string)=>{check();if(typeof key!=='string')throw new Error('Invalid key');if(operations.length>=10000)throw new Error('PostgreSQL write limit');operations.push({kind:'delete',namespace,key});return target.delete(key);};
       if(property==='clear')return ()=>{check();if(operations.length>=10000)throw new Error('PostgreSQL write limit');operations.push({kind:'clear',namespace});target.clear();};
       if(property==='forEach')return (fn:(value:V,key:string,map:Map<string,V>)=>void,thisArg?:unknown)=>{check();target.forEach((value,key)=>{check();fn.call(thisArg,value,key,proxy);});};
       if([Symbol.iterator,'entries','keys','values'].includes(property as any))return (...args:unknown[])=>{check();const iterator=Reflect.apply(Reflect.get(target,property),target,args) as Iterator<unknown>;return {next(){check();return iterator.next();},[Symbol.iterator](){return this;}};};
       if(property==='size')return target.size;
       if(property==='get'||property==='has')return (key:string)=>{check();return target[property](key);};
       throw new Error('Unsupported PostgreSQL map access');
      }});return proxy;
     },close(){throw new Error('PostgreSQL transaction owns store');}
    };
    savepoints.set(store,<R>(fn:()=>R):R=>{
     check();if(fn.constructor.name==='AsyncFunction')throw new Error('Savepoints require synchronous work');
     const mark=operations.length,backups=liveMaps.map(map=>structuredClone([...map]));
     try{const value=fn();if(value&&typeof (value as any).then==='function')throw new Error('Savepoints require synchronous work');return value;}
     catch(error){operations.splice(mark);liveMaps.forEach((map,i)=>{map.clear();for(const [k,v]of backups[i]??[])map.set(k,v);});throw error;}
    });
    const result=structuredClone(await work(store));active=false;savepoints.delete(store);
    for(const operation of operations){
     if(operation.kind==='clear')await c.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1 AND namespace=$2',[p.id,operation.namespace]);
     else if(operation.kind==='delete')await c.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1 AND namespace=$2 AND key=$3',[p.id,operation.namespace,operation.key]);
     else await c.query('INSERT INTO atarasy_member.engine_rows (deployment,namespace,key,value) VALUES ($1,$2,$3,$4) ON CONFLICT (deployment,namespace,key) DO UPDATE SET value=EXCLUDED.value',[p.id,operation.namespace,operation.key,operation.value]);
    }
    const after=await c.query('SELECT count(*)::int AS n,coalesce(sum(octet_length(value)),0)::text AS bytes FROM atarasy_member.engine_rows WHERE deployment=$1',[p.id]);
    if(after.rows[0].n>10000||Number(after.rows[0].bytes)>16_777_216)throw new Error('PostgreSQL snapshot limit');
    await c.query('COMMIT');return result;
   }catch(error){active=false;try{await c.query('ROLLBACK');}catch{broken=true;}throw error;}
   finally{active=false;c.release(broken);}
  }
 };
}
