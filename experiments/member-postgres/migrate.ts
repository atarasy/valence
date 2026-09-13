import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createPool } from './store.ts';
export async function migrateDatabase(connectionString:string) {
 const url=new URL(connectionString);if(url.hostname.includes('-pooler'))throw new Error('Use direct migration connection');
 const pool=createPool(connectionString);
 try{await migrate(drizzle(pool),{migrationsFolder:new URL('./migrations',import.meta.url).pathname});}finally{await pool.end();}
}
if(import.meta.main){if(!process.env.DATABASE_URL_UNPOOLED)throw new Error('DATABASE_URL_UNPOOLED required');await migrateDatabase(process.env.DATABASE_URL_UNPOOLED);}
