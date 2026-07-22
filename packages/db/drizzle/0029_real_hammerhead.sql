CREATE TYPE "public"."rag_chunk_source" AS ENUM('uploaded', 'open_access');--> statement-breakpoint
CREATE TYPE "public"."rag_conversation_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."rag_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "rag_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"processing_run_id" uuid NOT NULL,
	"text_block_id" uuid,
	"research_resource_content_id" uuid,
	"source_type" "rag_chunk_source" NOT NULL,
	"source_key" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"anchor" jsonb NOT NULL,
	"source_url" text,
	"license" text,
	"embedding" jsonb,
	"embedding_model" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rag_chunk_exactly_one_eligible_source" CHECK (("rag_chunk"."source_type" = 'uploaded' and "rag_chunk"."text_block_id" is not null and "rag_chunk"."research_resource_content_id" is null) or ("rag_chunk"."source_type" = 'open_access' and "rag_chunk"."research_resource_content_id" is not null and "rag_chunk"."text_block_id" is null))
);
--> statement-breakpoint
CREATE TABLE "rag_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"context_work_id" uuid,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"status" "rag_conversation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_message_citation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "rag_message_role" NOT NULL,
	"content" text NOT NULL,
	"model" text,
	"provider" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" real DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rag_chunk" ADD CONSTRAINT "rag_chunk_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_chunk" ADD CONSTRAINT "rag_chunk_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_chunk" ADD CONSTRAINT "rag_chunk_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_chunk" ADD CONSTRAINT "rag_chunk_processing_run_id_processing_run_id_fk" FOREIGN KEY ("processing_run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_chunk" ADD CONSTRAINT "rag_chunk_text_block_id_text_block_id_fk" FOREIGN KEY ("text_block_id") REFERENCES "public"."text_block"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_chunk" ADD CONSTRAINT "rag_chunk_research_resource_content_id_research_resource_content_id_fk" FOREIGN KEY ("research_resource_content_id") REFERENCES "public"."research_resource_content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_conversation" ADD CONSTRAINT "rag_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_conversation" ADD CONSTRAINT "rag_conversation_context_work_id_work_id_fk" FOREIGN KEY ("context_work_id") REFERENCES "public"."work"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_message_citation" ADD CONSTRAINT "rag_message_citation_message_id_rag_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."rag_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_message_citation" ADD CONSTRAINT "rag_message_citation_chunk_id_rag_chunk_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."rag_chunk"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_message" ADD CONSTRAINT "rag_message_conversation_id_rag_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."rag_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rag_chunk_user_idx" ON "rag_chunk" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rag_chunk_document_idx" ON "rag_chunk" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "rag_chunk_run_idx" ON "rag_chunk" USING btree ("processing_run_id");--> statement-breakpoint
CREATE INDEX "rag_chunk_resource_content_idx" ON "rag_chunk" USING btree ("research_resource_content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rag_chunk_owner_source_hash_index_unique" ON "rag_chunk" USING btree ("user_id","source_key","content_hash","chunk_index");--> statement-breakpoint
CREATE INDEX "rag_conversation_user_updated_idx" ON "rag_conversation" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rag_message_citation_message_chunk_unique" ON "rag_message_citation" USING btree ("message_id","chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rag_message_citation_message_ordinal_unique" ON "rag_message_citation" USING btree ("message_id","ordinal");--> statement-breakpoint
CREATE INDEX "rag_message_citation_chunk_idx" ON "rag_message_citation" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "rag_message_conversation_created_idx" ON "rag_message" USING btree ("conversation_id","created_at");