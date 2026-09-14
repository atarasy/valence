import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {createPool,initialiseDeployment,postgresStore} from './store.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {prepareDeviceAcceptance,deviceAcceptanceStatus,inviteDeviceAcceptance,prepareStatementAcceptance} from './device-acceptance.ts';
import type {MemberRuntimeConfig} from './config.ts';
import config from './deployment/config.json';
import {syntheticAuthenticator} from '../member-login/fixtures/authenticator.ts';
test('trusted statement acceptance lets the registered passkey approve one physical statement through HTTP',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Isolated PostgreSQL URL required');
 const pool=createPool(url),c=config as MemberRuntimeConfig,id={id:'statement_'+randomUUID().replaceAll('-',''),environment:c.environment,origin:c.origin,epoch:1},unit=postgresStore(pool,id);
 try{
  await initialiseDeployment(pool,id);const app=await openPostgresMemberHTTP(pool,id,c);
  const send=(path:string,body?:unknown,token?:string)=>app.fetch(new Request(c.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{peer:'statement-test'});
  const prepared=await unit.run(s=>prepareDeviceAcceptance(s,c));
  await expect(unit.run(s=>prepareStatementAcceptance(s,c))).rejects.toThrow('Exactly one active acceptance credential');
  const invitation=await unit.run(s=>inviteDeviceAcceptance(s,c)),key=syntheticAuthenticator();
  const flow=await (await send('/auth/enrollment/options',{invitation:invitation.token})).json();
  expect((await send('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  const userHandle=flow.publicKey.user.id,signIn=async(counter:number)=>{const f=await (await send('/auth/login/options',{})).json();const reply=await send('/auth/login/verify',{id:f.id,response:key.authenticate(f.publicKey.challenge,c.origin,c.rpID,userHandle,counter)});expect(reply.status).toBe(200);return (await reply.json()).token as string;};
  const before=await signIn(1);
  const statement=await unit.run(s=>prepareStatementAcceptance(s,c));
  expect(statement.household).toBe(prepared.household);
  await expect(unit.run(s=>prepareStatementAcceptance(s,c))).rejects.toThrow('already prepared');
  // The grant change revokes the earlier session and the internal binding session leaves nothing live.
  expect((await send('/auth/session',undefined,before)).status).toBe(401);
  expect(await unit.run(s=>[...s.map<{credential:string;revoked:number}>('member_sessions').values()].filter(v=>v.revoked===0).length)).toBe(0);
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({activeCredentials:1,presenterGrants:1,statement:{offer:statement.offer,mandate:statement.mandate,presenter:statement.presenter,settled:false}});
  const token=await signIn(2);
  expect((await (await send('/auth/session',undefined,token)).json()).presenters).toEqual([statement.presenter]);
  const list=await (await send('/offers?household='+prepared.household+'&presenter='+statement.presenter,undefined,token)).json();
  expect(list.offers.map((o:{id:string})=>o.id)).toEqual([statement.offer]);
  expect((await send('/offers/'+statement.offer+'/statement',undefined,token)).status).toBe(200);
  const p=await (await send('/member/statements/prepare',{offer:statement.offer,disputed:[]},token)).json();
  expect(p.publicKey.allowCredentials).toEqual([{type:'public-key',id:key.id}]);
  const path='/member/operations/'+p.operationID,submitted=await send(path+'/submit',{assertion:key.authenticate(p.publicKey.challenge,c.origin,c.rpID,userHandle,3)},token);
  expect(submitted.status).toBe(200);const receipt=await submitted.json();expect(receipt.operationState).toBe('committed');
  expect(await (await send(path+'/outcome',undefined,token)).json()).toEqual(receipt);
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({statement:{settled:true}});
 }finally{
  await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id.id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id.id]);await pool.end();
 }
},60000);
