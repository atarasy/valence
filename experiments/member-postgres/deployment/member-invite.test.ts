import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,statSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Pool} from 'pg';
import {createPool,initialiseDeployment,postgresStore} from '../store.ts';
import {openPostgresMemberHTTP} from '../http.ts';
import {issueReviewInvitation} from '../review-invitation.ts';
import {TARGETS} from './targets.ts';
import {syntheticAuthenticator} from '../../member-login/fixtures/authenticator.ts';

const PROD='weathered-violet-85512339',DEV='young-pond-73223516';
const run=async(script:string,args:string[],env:Record<string,string|undefined>)=>{
 const child=Bun.spawn([process.execPath,new URL(script,import.meta.url).pathname,...args],{stdout:'pipe',stderr:'pipe',env:{PATH:process.env.PATH,...env} as Record<string,string>});
 const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {stdout,stderr,code};
};

test('the review invitation is production-only, single-use and never printed; bootstrap and the proposal command refuse the other target\'s database',async()=>{
 const base=process.env.ATARASY_TEST_POSTGRES_URL;if(!base)throw new Error('Isolated PostgreSQL URL required');
 const admin=new Pool({connectionString:base}),prodDB='inv_'+randomUUID().replaceAll('-',''),devDB='inv_'+randomUUID().replaceAll('-','');
 const at=(name:string)=>{const u=new URL(base);u.pathname='/'+name;return u.toString();};
 const dir=mkdtempSync(join(tmpdir(),'member-invite-'));
 try{
  await admin.query(`CREATE DATABASE ${prodDB}`);await admin.query(`CREATE DATABASE ${devDB}`);
  const prodEnv={NEON_PROJECT_ID:PROD,DATABASE_URL_UNPOOLED:at(prodDB)},devEnv={NEON_PROJECT_ID:DEV,DATABASE_URL_UNPOOLED:at(devDB)};

  // Bootstrap each target into its own database.
  expect(await run('./bootstrap.ts',['--target','production'],prodEnv)).toMatchObject({code:0});
  expect(await run('./bootstrap.ts',[],devEnv)).toMatchObject({code:0});
  // The label guard: the other project's id is refused before any connection.
  expect((await run('./bootstrap.ts',['--target','production'],{...prodEnv,NEON_PROJECT_ID:DEV})).code).not.toBe(0);
  expect((await run('./bootstrap.ts',[],{...devEnv,NEON_PROJECT_ID:PROD})).code).not.toBe(0);
  // The database guard: the right label on the other target's database is refused too, and writes nothing.
  const crossed=await run('./bootstrap.ts',['--target','production'],{NEON_PROJECT_ID:PROD,DATABASE_URL_UNPOOLED:at(devDB)});
  expect(crossed.code).not.toBe(0);expect(crossed.stderr).toContain('another target');
  expect((await run('./bootstrap.ts',[],{NEON_PROJECT_ID:DEV,DATABASE_URL_UNPOOLED:at(prodDB)})).code).not.toBe(0);
  for(const [db,expected] of [[prodDB,['production']],[devDB,['development']]] as const){
   const pool=new Pool({connectionString:at(db)});
   try{expect((await pool.query('SELECT environment FROM atarasy_member.control')).rows.map(r=>r.environment)).toEqual([...expected]);}finally{await pool.end();}
  }

  // The invitation command refuses the development project id, and the development database under the production id.
  const refusedFile=join(dir,'refused.json');
  const wrongLabel=await run('./member-invite.ts',['issue',refusedFile],{...prodEnv,NEON_PROJECT_ID:DEV});
  expect(wrongLabel.code).not.toBe(0);expect(existsSync(refusedFile)).toBe(false);
  const wrongDatabase=await run('./member-invite.ts',['issue',refusedFile],{NEON_PROJECT_ID:PROD,DATABASE_URL_UNPOOLED:at(devDB)});
  expect(wrongDatabase.code).not.toBe(0);expect(wrongDatabase.stderr).toContain('another target');expect(existsSync(refusedFile)).toBe(false);
  expect((await run('./member-invite.ts',['issue','relative.json'],prodEnv)).code).not.toBe(0);

  // Issue: exclusive 0600 file, token absent from stdout and stderr.
  const file=join(dir,'invitation.json');
  const issued=await run('./member-invite.ts',['issue',file],prodEnv);
  expect(issued).toMatchObject({code:0,stderr:''});
  const written=await Bun.file(file).json() as {origin:string;token:string;expiresAt:number};
  expect(written.origin).toBe('https://members.vox.delivery');expect(written.token).toMatch(/^aen1_/);
  expect(statSync(file).mode&0o777).toBe(0o600);
  expect(issued.stdout).not.toContain(written.token);
  const {principal}=JSON.parse(issued.stdout) as {principal:string};expect(principal).toMatch(/^review_member_/);
  // The proposal command shares the guard, and refuses a review principal that has not enrolled and signed in.
  const proposal=(env:Record<string,string|undefined>,who=principal)=>run('./review-proposal.ts',['propose',who],env);
  expect((await proposal({...prodEnv,NEON_PROJECT_ID:DEV})).code).not.toBe(0);
  const proposalCrossed=await proposal({NEON_PROJECT_ID:PROD,DATABASE_URL_UNPOOLED:at(devDB)});
  expect(proposalCrossed.code).not.toBe(0);expect(proposalCrossed.stderr).toContain('another target');
  expect((await proposal(prodEnv,'dev_member_x')).code).not.toBe(0);
  const unenrolled=await proposal(prodEnv);
  expect(unenrolled.code).toBe(1);expect(unenrolled.stdout).toBe('');expect(unenrolled.stderr).toContain('0 have signed in and 0 have not');
  // An existing output file is refused and left as it was.
  const again=await run('./member-invite.ts',['issue',file],prodEnv);
  expect(again.code).not.toBe(0);expect((await Bun.file(file).json()).token).toBe(written.token);

  // The token enrols a passkey exactly once, on the production relying party.
  const p=TARGETS.production,c=p.config,identity={id:p.deploymentID,environment:c.environment,origin:c.origin,epoch:1};
  const pool=createPool(at(prodDB));
  try{
   const app=await openPostgresMemberHTTP(pool,identity,c);
   const post=(path:string,body:unknown)=>app.fetch(new Request(c.origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),{peer:'review-invite-test'});
   const start=await post('/auth/enrollment/options',{invitation:written.token});expect(start.status).toBe(200);
   const flow=await start.json(),key=syntheticAuthenticator();
   expect(flow.publicKey.rp.id).toBe('members.vox.delivery');
   expect((await post('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
   expect((await post('/auth/enrollment/options',{invitation:written.token})).status).toBe(401);
   // The principal is unclaimed with no presenter grants, and holds the one credential it enrolled.
   const unit=postgresStore(pool,identity);
   expect(await unit.run(s=>{
    const row=s.map<{household:string|null;presenters:string;disabled:number}>('member_principals').get(principal);
    const credentials=[...s.map<{principal:string;revoked:number}>('member_credentials').values()].filter(v=>v.principal===principal&&v.revoked===0).length;
    return {household:row?.household,presenters:row?.presenters,disabled:row?.disabled,credentials,recorded:s.map('member_review_invitations').has(principal)};
   })).toEqual({household:null,presenters:'[]',disabled:0,credentials:1,recorded:true});
  }finally{await pool.end();}

  // The module refuses a development configuration even when handed a store directly.
  const d=TARGETS.development,devIdentity={id:'invdev_'+randomUUID().replaceAll('-',''),environment:d.config.environment,origin:d.config.origin,epoch:1};
  const devPool=createPool(at(devDB));
  try{
   await initialiseDeployment(devPool,devIdentity);await openPostgresMemberHTTP(devPool,devIdentity,d.config);
   await expect(postgresStore(devPool,devIdentity).run(s=>issueReviewInvitation(s,d.config))).rejects.toThrow('Review configuration unavailable');
  }finally{await devPool.end();}
 }finally{
  rmSync(dir,{recursive:true,force:true});
  for(const n of [prodDB,devDB])await admin.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`);
  await admin.end();
 }
},120000);
