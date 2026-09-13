CREATE SCHEMA "atarasy_member";
--> statement-breakpoint
CREATE TABLE "atarasy_member"."control" (
	"id" text PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"origin" text NOT NULL,
	"epoch" integer NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "positive_epoch" CHECK ("atarasy_member"."control"."epoch" > 0)
);
--> statement-breakpoint
CREATE TABLE "atarasy_member"."engine_rows" (
	"deployment" text NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"ordinal" bigint GENERATED ALWAYS AS IDENTITY (sequence name "atarasy_member"."engine_rows_ordinal_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	CONSTRAINT "engine_rows_deployment_namespace_key_pk" PRIMARY KEY("deployment","namespace","key"),
	CONSTRAINT "namespace_format" CHECK ("atarasy_member"."engine_rows"."namespace" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "value_size" CHECK (octet_length("atarasy_member"."engine_rows"."value") <= 1048576)
);
--> statement-breakpoint
ALTER TABLE "atarasy_member"."engine_rows" ADD CONSTRAINT "engine_rows_deployment_control_id_fk" FOREIGN KEY ("deployment") REFERENCES "atarasy_member"."control"("id") ON DELETE no action ON UPDATE no action;