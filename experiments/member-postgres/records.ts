import type { Store } from '../../engine/src/common/store.ts';
import { storeSavepoint } from './store.ts';
const owners=new WeakMap<object,Records>();
export function memberRecords(store:Store,scope:{environment:string;audience:string}) {
 const check=()=>{storeSavepoint(store,()=>null);};
 const path={scope:Object.freeze({...scope}),store,
  register<T extends object>(value:T):T{check();owners.set(value,path);return value;},
  assert(...values:object[]){check();if(values.some(v=>owners.get(v)!==path))throw new Error('Mixed PostgreSQL participants');},
  transaction<T>(fn:()=>T){const call=()=>storeSavepoint(store,fn);return Object.assign(call,{immediate:call});},
  close(){check();},
 };return path;
}
export type Records=ReturnType<typeof memberRecords>;
/** Detached records: a successful write must be explicit, and immutable identifiers cannot be overwritten. */
export function records<T extends object>(path:Records,namespace:string){
 const map=path.store.map<T>(namespace);
 const get=(key:string)=>{const value=map.get(key);return value===undefined?null:structuredClone(value);};
 const put=(key:string,value:T)=>{map.set(key,structuredClone(value));};
 const insert=(key:string,value:T)=>{if(map.has(key))throw new Error('Duplicate member record');put(key,value);};
 return {get,put,insert,delete:(key:string)=>map.delete(key),
  insertIfAbsent(key:string,value:T){if(!map.has(key))insert(key,value);},
  patch(key:string,value:Partial<T>){const old=get(key);if(old)put(key,{...old,...value});},
  updateWhere(key:string,predicate:(value:T)=>boolean,value:Partial<T>){const old=get(key);if(!old||!predicate(old))return {changes:0};put(key,{...old,...value});return {changes:1};},
  find(predicate:(value:T)=>boolean){for(const value of map.values()){const fixed=structuredClone(value);if(predicate(fixed))return fixed;}return null;},
  each(fn:(value:T)=>void){for(const value of [...map.values()])fn(structuredClone(value));},
  deleteWhere(predicate:(value:T)=>boolean){for(const [key,value]of map)if(predicate(structuredClone(value)))map.delete(key);},
 };
}
