import {openSync,writeFileSync,closeSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createPublicKey,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {createPool,postgresStore} from './store.ts';
import {memberRuntime} from './runtime.ts';
import {credentialSPKI} from '../member-login/credential-key.ts';
import {canonicalMandate} from '../../engine/src/hub/mandates.ts';
import {assertLocalDatabaseUrl,localPort,localIdentity,localConfig} from './local-shared.ts';

/**
 * The one household OPS-01 has no way to make (README, "No passkey ceremony
 * works here"): WebAuthn refuses an IP address as a relying party, so no real
 * passkey can enrol against `127.0.0.1` and no presenter has anyone to make
 * an offer to. This writes exactly the rows a real enrolment and adoption
 * would (`provisionUnclaimedPrincipal` -> `registerCredential` ->
 * `login.provisionVerifiedPasskey` -> `authority.markCredentialProven` ->
 * `authority.adoptHousehold`, the sequence `http.test.ts`'s fixtures use),
 * against a P-256 key pair generated here instead of a device's, and records
 * a standing mandate signed by that same pair through `engine.mandates.record`.
 * `bindings.importMandate` only writes a claim an offer cannot use
 * (`mandate_unavailable`); this records the mandate itself.
 *
 * The presenter named on the command line is granted at provisioning, so its
 * offers to this household are allowed both by `authority.holdsHousehold`
 * (presenter-http.ts's `/presenter/offers`) and by the member grant list
 * `member-read/gate.ts` checks.
 */
const [action,presenter,output,...extra]=process.argv.slice(2);
if(action!=='create'||extra.length||!presenter||!output||!isAbsolute(output))throw new Error('Usage: local-household.ts create <presenter> /abs/private/household.json');
const databaseUrl=process.env.LOCAL_DATABASE_URL;
if(!databaseUrl)throw new Error('LOCAL_DATABASE_URL required (a local PostgreSQL connection string, e.g. postgres://127.0.0.1/atarasy_local)');
assertLocalDatabaseUrl(databaseUrl);
const port=localPort(),identity=localIdentity(port),c=localConfig(port);
const pool=createPool(databaseUrl),unit=postgresStore(pool,identity);
try{
 // Exclusive creation refuses existing files and symlinks; the private key is never printed.
 const fd=openSync(output!,'wx',0o600);
 try{
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'});
  const cose=Buffer.concat([Buffer.from('a5010203262001215820','hex'),Buffer.from(jwk.x!,'base64url'),Buffer.from('225820','hex'),Buffer.from(jwk.y!,'base64url')]);
  const principal='local-household-'+randomUUID(),credential=randomBytes(32).toString('base64url'),user=randomBytes(32).toString('base64url');
  const {household,mandate}=await unit.run(store=>{
   const r=memberRuntime(store,c);
   r.authority.provisionUnclaimedPrincipal(principal,[presenter!]);
   r.authority.registerCredential(credential,principal);
   // Stands in for a verified WebAuthn ceremony: same rows, no ceremony,
   // exactly what `provisionVerifiedPasskey` and `markCredentialProven` are
   // for (`local.ts`'s own docstring; §13.2, question 55).
   r.login.provisionVerifiedPasskey(credential,cose,0,user);
   r.authority.markCredentialProven(credential);
   const household=r.authority.adoptHousehold(principal,credential);
   const key=r.login.verifiedPublicKey(credential)!;
   const pem=createPublicKey({key:credentialSPKI(key),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString();
   r.engine.registerIdentity(household,pem);
   const at=Date.now(),mandateID=household+'.1';
   // §16.1: a standing mandate, generous enough for a manual walkthrough and
   // signed by the household's own key, exactly as clause 58 and §16.1 ask.
   const terms={id:mandateID,household,ceiling_out_of_network:50000,ceiling_daily:null,cooling_seconds:null,co_signers:[],lapses_at:at+7*24*60*60*1000,version:1};
   const bytes=canonicalMandate(terms,c.rpID),signature=sign('sha256',bytes,pair.privateKey).toString('base64');
   r.engine.mandates.record({mandate:terms,signatures:{[household]:signature},assertions:{},keyOf:(k:string)=>r.engine.publicKeyFor(k),relyingPartyId:c.rpID});
   return {household,mandate:mandateID};
  });
  const privateKeyPem=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString();
  writeFileSync(fd,JSON.stringify({household,mandate,privateKeyPem})+'\n');
  console.log(JSON.stringify({household,mandate}));
 }finally{closeSync(fd);}
}catch(error){console.error('Local household command failed:',error instanceof Error?error.message:String(error));process.exitCode=1;}
finally{await pool.end();}
