import { pgSchema, text, integer, boolean, bigint, primaryKey, check, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const member = pgSchema('atarasy_member');
export const control = member.table('control', {
 id: text('id').primaryKey(), environment: text('environment').notNull(), origin: text('origin').notNull(),
 epoch: integer('epoch').notNull(), enabled: boolean('enabled').notNull(),
}, t => [check('positive_epoch', sql`${t.epoch} > 0`)]);
export const engineRows = member.table('engine_rows', {
 deployment: text('deployment').notNull().references(()=>control.id), namespace: text('namespace').notNull(),
 key: text('key').notNull(), value: text('value').notNull(), ordinal: bigint('ordinal',{mode:'bigint'}).generatedAlwaysAsIdentity(),
}, t => [uniqueIndex('one_blocking_member_statement').on(t.deployment,sql`(${t.value}::jsonb->>'offer')`,sql`(CASE WHEN ${t.value}::jsonb->>'kind' IN ('digital_decision','digital_withdrawal') THEN COALESCE((${t.value}::jsonb->>'incarnation')::bigint,0) ELSE 0 END)`,sql`(CASE WHEN ${t.value}::jsonb->>'kind' = 'digital_withdrawal' THEN 'withdrawal' ELSE 'decision' END)`).where(sql`${t.namespace} = 'member_operations' AND (${t.value}::jsonb->>'state') IN ('prepared','dispatching','uncertain','committed')`),primaryKey({columns:[t.deployment,t.namespace,t.key]}), check('namespace_format',sql`${t.namespace} ~ '^[a-z][a-z0-9_]{0,63}$'`), check('value_size',sql`octet_length(${t.value}) <= 1048576`)]);
