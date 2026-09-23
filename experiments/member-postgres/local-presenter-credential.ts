import {openSync,readFileSync,writeFileSync,closeSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createPublicKey} from 'node:crypto';
import {createPool,postgresStore} from './store.ts';
import {memberRuntime} from './runtime.ts';
import {registerPresenter} from './presenter-http.ts';
import {assertLocalDatabaseUrl,localPort,localIdentity,localConfig} from './local-shared.ts';

/**
 * Local variant of `deployment/presenter-credential.ts`. Same shape and same
 * usage, minus the Neon project check `deployment/presenter-credential.ts`
 * makes (there is no dedicated Neon project here) and with
 * `assertLocalDatabaseUrl` in its place. Run it against the same
 * LOCAL_DATABASE_URL and PORT as `local.ts`, while that server is running or
 * not; either way it writes straight into the same PostgreSQL rows the
 * server reads on its next request.
 */
const [action,presenter,presenterName,presenterKeyPath,merchant,merchantKeyPath,output,...extra]=process.argv.slice(2);
const paths=[presenterKeyPath,merchantKeyPath,output];
if(action!=='issue'||extra.length||!presenter||!presenterName||!merchant||paths.some(p=>!p||!isAbsolute(p)))throw new Error('Usage: local-presenter-credential.ts issue <presenter> <display-name> /abs/presenter.pem <merchant> /abs/merchant.pem /abs/private/new-credential.json');
const databaseUrl=process.env.LOCAL_DATABASE_URL;
if(!databaseUrl)throw new Error('LOCAL_DATABASE_URL required (a local PostgreSQL connection string, e.g. postgres://127.0.0.1/atarasy_local)');
assertLocalDatabaseUrl(databaseUrl);
// Parse before connecting, so a wrong file fails without touching the database.
const pem=(path:string)=>createPublicKey(readFileSync(path,'utf8')).export({type:'spki',format:'pem'}).toString();
const presenterKey=pem(presenterKeyPath!),merchantKey=pem(merchantKeyPath!);
const port=localPort(),identity=localIdentity(port),c=localConfig(port);
const pool=createPool(databaseUrl),unit=postgresStore(pool,identity);
try{
 // Exclusive creation refuses existing files and symlinks; the token is never printed.
 const fd=openSync(output!,'wx',0o600);
 try{
  const issued=await unit.run(s=>registerPresenter(memberRuntime(s,c),{presenter:presenter!,presenterName:presenterName!,presenterKey,merchant:merchant!,merchantKey,at:Date.now()}));
  writeFileSync(fd,JSON.stringify(issued)+'\n');
  console.log(JSON.stringify({issued:true,presenter:issued.presenter,output}));
 }finally{closeSync(fd);}
}catch(error){console.error('Local presenter credential command failed:',error instanceof Error?error.message:String(error));process.exitCode=1;}
finally{await pool.end();}
