import { pgSchema, text, integer, boolean, bigint, primaryKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const member = pgSchema('atarasy_member');
export const control = member.table('control', {
 id: text('id').primaryKey(), environment: text('environment').notNull(), origin: text('origin').notNull(),
 epoch: integer('epoch').notNull(), enabled: boolean('enabled').notNull(),
}, t => [check('positive_epoch', sql`${t.epoch} > 0`)]);
export const engineRows = member.table('engine_rows', {
 deployment: text('deployment').notNull().references(()=>control.id), namespace: text('namespace').notNull(),
 key: text('key').notNull(), value: text('value').notNull(), ordinal: bigint('ordinal',{mode:'bigint'}).generatedAlwaysAsIdentity(),
}, t => [primaryKey({columns:[t.deployment,t.namespace,t.key]}), check('namespace_format',sql`${t.namespace} ~ '^[a-z][a-z0-9_]{0,63}$'`), check('value_size',sql`octet_length(${t.value}) <= 1048576`)]);
