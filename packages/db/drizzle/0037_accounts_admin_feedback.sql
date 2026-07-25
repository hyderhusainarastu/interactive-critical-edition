CREATE TYPE "public"."feedback_category" AS ENUM('bug', 'idea', 'praise', 'other');--> statement-breakpoint
CREATE TYPE "public"."usage_event_type" AS ENUM('page_view', 'session_start', 'upload', 'chat_message', 'feedback');--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text,
	"category" "feedback_category" NOT NULL,
	"body" text NOT NULL,
	"path" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp,
	CONSTRAINT "feedback_body_length" CHECK (char_length("feedback"."body") <= 10000)
);
--> statement-breakpoint
CREATE TABLE "usage_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"event_type" "usage_event_type" NOT NULL,
	"path" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_deletion_archive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"user_created_at" timestamp NOT NULL,
	"deleted_at" timestamp DEFAULT now() NOT NULL,
	"docs_processed" integer,
	"total_ai_cost_usd" real,
	"chat_messages" integer,
	"last_active_at" timestamp,
	"reader_level" text,
	"data_sharing_was_enabled" boolean
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "data_sharing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "policy_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_created_at_idx" ON "feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_event_user_created_idx" ON "usage_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_event_type_created_idx" ON "usage_event" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_deletion_archive_user_unique" ON "user_deletion_archive" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_deletion_archive_deleted_at_idx" ON "user_deletion_archive" USING btree ("deleted_at");