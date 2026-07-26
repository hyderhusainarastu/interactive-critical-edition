CREATE TYPE "public"."research_job_coverage" AS ENUM('full', 'partial', 'sampled');--> statement-breakpoint
CREATE TYPE "public"."research_job_status" AS ENUM('planned', 'queued', 'running', 'complete', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."research_job_type" AS ENUM('extract_claims', 'detect_relationships', 'cluster_debates', 'synthesize_chamber', 'generate_hypotheses', 'import_corpus', 'run_monitor');--> statement-breakpoint
CREATE TYPE "public"."research_member_role" AS ENUM('central', 'supporting', 'background');--> statement-breakpoint
CREATE TYPE "public"."research_member_type" AS ENUM('work', 'corpus_item', 'writer_project', 'rag_conversation');--> statement-breakpoint
CREATE TYPE "public"."research_object_type" AS ENUM('claim', 'relationship', 'cluster', 'chamber', 'position', 'hypothesis', 'gap');--> statement-breakpoint
CREATE TYPE "public"."research_revision_action" AS ENUM('generated', 'verified', 'disputed', 'edited', 'split', 'merged', 'hidden', 'restored', 'reclassified');--> statement-breakpoint
CREATE TABLE "research_job_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_type" "research_job_type" NOT NULL,
	"scope" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "research_job_status" DEFAULT 'planned' NOT NULL,
	"stage" text,
	"progress_index" integer,
	"progress_total" integer,
	"estimated_cost_usd" real DEFAULT 0 NOT NULL,
	"actual_cost_usd" real DEFAULT 0 NOT NULL,
	"requires_confirmation" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp,
	"coverage" "research_job_coverage",
	"note" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "research_job_request_cost_valid" CHECK ("research_job_request"."estimated_cost_usd" >= 0 AND "research_job_request"."actual_cost_usd" >= 0),
	CONSTRAINT "research_job_request_progress_valid" CHECK (("research_job_request"."progress_index" IS NULL OR "research_job_request"."progress_index" >= 0)
        AND ("research_job_request"."progress_total" IS NULL OR "research_job_request"."progress_total" >= 0))
);
--> statement-breakpoint
CREATE TABLE "research_project_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"member_type" "research_member_type" NOT NULL,
	"work_id" uuid,
	"writer_project_id" uuid,
	"rag_conversation_id" uuid,
	"role" "research_member_role" DEFAULT 'supporting' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "research_project_member_typed_target" CHECK (("research_project_member"."member_type" = 'work' AND "research_project_member"."work_id" IS NOT NULL AND "research_project_member"."writer_project_id" IS NULL AND "research_project_member"."rag_conversation_id" IS NULL)
        OR ("research_project_member"."member_type" = 'writer_project' AND "research_project_member"."writer_project_id" IS NOT NULL AND "research_project_member"."work_id" IS NULL AND "research_project_member"."rag_conversation_id" IS NULL)
        OR ("research_project_member"."member_type" = 'rag_conversation' AND "research_project_member"."rag_conversation_id" IS NOT NULL AND "research_project_member"."work_id" IS NULL AND "research_project_member"."writer_project_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "research_project_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"question" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "research_project_question_order_unique" UNIQUE("project_id","sort_order")
);
--> statement-breakpoint
CREATE TABLE "research_project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_type" "research_object_type" NOT NULL,
	"revision" integer NOT NULL,
	"action" "research_revision_action" NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"editor" "provenance_source" NOT NULL,
	"editor_user_id" uuid,
	"reason" text,
	"prompt_version" text,
	"provider" text,
	"model" text,
	"related_object_ids" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "research_revision_no_auto_endorsement" CHECK (("research_revision"."action" = 'generated' AND "research_revision"."editor" = 'system') OR ("research_revision"."action" <> 'generated' AND "research_revision"."editor" <> 'system')),
	CONSTRAINT "research_revision_generated_is_zero" CHECK (("research_revision"."action" <> 'generated') OR ("research_revision"."revision" = 0))
);
--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD COLUMN "research_request_id" uuid;--> statement-breakpoint
ALTER TABLE "research_job_request" ADD CONSTRAINT "research_job_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_project_member" ADD CONSTRAINT "research_project_member_project_id_research_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."research_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_project_member" ADD CONSTRAINT "research_project_member_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_project_member" ADD CONSTRAINT "research_project_member_writer_project_id_writer_project_id_fk" FOREIGN KEY ("writer_project_id") REFERENCES "public"."writer_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_project_member" ADD CONSTRAINT "research_project_member_rag_conversation_id_rag_conversation_id_fk" FOREIGN KEY ("rag_conversation_id") REFERENCES "public"."rag_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_project_question" ADD CONSTRAINT "research_project_question_project_id_research_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."research_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_project" ADD CONSTRAINT "research_project_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_editor_user_id_user_id_fk" FOREIGN KEY ("editor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_job_request_user_type_status_idx" ON "research_job_request" USING btree ("user_id","job_type","status");--> statement-breakpoint
CREATE INDEX "research_job_request_user_created_idx" ON "research_job_request" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_job_request_inflight_idempotency_unique" ON "research_job_request" USING btree ("user_id","idempotency_key") WHERE "research_job_request"."status" in ('planned', 'queued', 'running');--> statement-breakpoint
CREATE INDEX "research_project_member_project_idx" ON "research_project_member" USING btree ("project_id","member_type");--> statement-breakpoint
CREATE INDEX "research_project_member_work_idx" ON "research_project_member" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_project_member_work_unique" ON "research_project_member" USING btree ("project_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_project_member_writer_unique" ON "research_project_member" USING btree ("project_id","writer_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_project_member_conversation_unique" ON "research_project_member" USING btree ("project_id","rag_conversation_id");--> statement-breakpoint
CREATE INDEX "research_project_user_archived_idx" ON "research_project" USING btree ("user_id","archived_at","sort_order");--> statement-breakpoint
CREATE INDEX "research_revision_user_object_idx" ON "research_revision" USING btree ("user_id","object_type","created_at");--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_research_request_id_research_job_request_id_fk" FOREIGN KEY ("research_request_id") REFERENCES "public"."research_job_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_log_research_request_idx" ON "ai_usage_log" USING btree ("research_request_id");