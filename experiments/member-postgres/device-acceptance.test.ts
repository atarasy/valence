import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {createPool,initialiseDeployment,postgresStore} from './store.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {prepareDeviceAcceptance,deviceAcceptanceStatus,inviteDeviceAcceptance} from './device-acceptance.ts';
import {memberRuntime} from './runtime.ts';
import type {MemberRuntimeConfig} from './config.ts';
import config from './deployment/config.json';
import {syntheticAuthenticator} from '../member-login/fixtures/authenticator.ts';
test('trusted acceptance survives duplicate preparation, registers through HTTP, and refuses changed grants',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Isolated PostgreSQL URL required');
 const pool=createPool(url),c=config as MemberRuntimeConfig,id={id:'accept_'+randomUUID().replaceAll('-',''),environment:c.environment,origin:c.origin,epoch:1},unit=postgresStore(pool,id);
 try{
  await initialiseDeployment(pool,id);const app=await openPostgresMemberHTTP(pool,id,c);
  const prepared=await unit.run(s=>prepareDeviceAcceptance(s,c));
  await expect(unit.run(s=>prepareDeviceAcceptance(s,c))).rejects.toThrow('already prepared');
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({...prepared,prepared:true,activeCredentials:0,presenterGrants:0});
  const invitation=await unit.run(s=>inviteDeviceAcceptance(s,c));
  const post=(path:string,body:unknown)=>app.fetch(new Request(c.origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),{peer:'acceptance-test'});
  const start=await post('/auth/enrollment/options',{invitation:invitation.token});expect(start.status).toBe(200);const flow=await start.json(),key=syntheticAuthenticator();
  expect((await post('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  expect((await post('/auth/enrollment/options',{invitation:invitation.token})).status).toBe(401);
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({activeCredentials:1,presenterGrants:0});
  await unit.run(s=>memberRuntime(s,c).authority.setPresenterGrants(prepared.principal,['unexpected-presenter']));
  await expect(unit.run(s=>inviteDeviceAcceptance(s,c))).rejects.toThrow('changed or unavailable');
  await expect(unit.run(s=>deviceAcceptanceStatus(s,c))).rejects.toThrow('changed or unavailable');
 }finally{
  await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id.id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id.id]);await pool.end();
 }
},60000);
