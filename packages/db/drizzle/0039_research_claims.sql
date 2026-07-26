-- pgvector is already enabled on Supabase (per docs/PROJECT-LOG.md) but has
-- never been used by this schema until now (research_claim_embedding below)
-- — IF NOT EXISTS makes this safe to run again on an environment where it's
-- already on, and is what actually turns it on for a fresh local database.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."claim_anchor_state" AS ENUM('anchored', 'rebound', 'unanchored');--> statement-breakpoint
CREATE TYPE "public"."claim_locus_origin" AS ENUM('excerpt', 'block', 'footnote', 'citation');--> statement-breakpoint
CREATE TYPE "public"."claim_nature" AS ENUM('empirical', 'textual', 'interpretive', 'historical', 'conceptual', 'normative', 'definitional', 'methodological');--> statement-breakpoint
CREATE TYPE "public"."claim_score_dimension" AS ENUM('evidence_strength', 'textual_support');--> statement-breakpoint
CREATE TYPE "public"."claim_score_label" AS ENUM('strong', 'moderate', 'weak');--> statement-breakpoint
CREATE TYPE "public"."claim_source_scope" AS ENUM('full_text', 'abstract', 'sampled');--> statement-breakpoint
CREATE TYPE "public"."corpus_source" AS ENUM('semanticscholar', 'openalex', 'arxiv');--> statement-breakpoint
CREATE TYPE "public"."research_object_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TABLE "claim_locus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"locus_key" text NOT NULL,
	"origin" "claim_locus_origin" NOT NULL,
	"raw_locus" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_score" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"dimension" "claim_score_dimension" NOT NULL,
	"score" real NOT NULL,
	"label" "claim_score_label" NOT NULL,
	"tier" text,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scorer_version" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_claim_embedding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"dim" integer DEFAULT 1536 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid,
	"corpus_item_id" uuid,
	"processing_run_id" uuid,
	"text_block_id" uuid,
	"quote" text,
	"prefix" text,
	"suffix" text,
	"anchor_state" "claim_anchor_state" DEFAULT 'anchored' NOT NULL,
	"claim_text" text NOT NULL,
	"claim_nature" "claim_nature" NOT NULL,
	"claim_role" text,
	"confidence" text NOT NULL,
	"section" text NOT NULL,
	"source_scope" "claim_source_scope" NOT NULL,
	"supporting_excerpt" text NOT NULL,
	"excerpt_verified" boolean DEFAULT false NOT NULL,
	"content_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" "research_object_status" DEFAULT 'active' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unreviewed' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "research_claim_exactly_one_source" CHECK (("research_claim"."work_id" IS NOT NULL AND "research_claim"."corpus_item_id" IS NULL) OR ("research_claim"."work_id" IS NULL AND "research_claim"."corpus_item_id" IS NOT NULL)),
	CONSTRAINT "research_claim_grounded" CHECK ("research_claim"."text_block_id" IS NOT NULL OR "research_claim"."source_scope" = 'abstract' OR "research_claim"."anchor_state" = 'unanchored'),
	CONSTRAINT "research_claim_excerpt_nonempty" CHECK (char_length(trim("research_claim"."supporting_excerpt")) > 0)
);
--> statement-breakpoint
CREATE TABLE "research_corpus_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "corpus_source" NOT NULL,
	"external_id" text NOT NULL,
	"dedup_key" text NOT NULL,
	"title" text NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"year" integer,
	"doi" text,
	"url" text,
	"abstract" text,
	"venue" text,
	"raw" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_project_member" DROP CONSTRAINT "research_project_member_typed_target";--> statement-breakpoint
ALTER TABLE "research_project_member" ADD COLUMN "corpus_item_id" uuid;--> statement-breakpoint
ALTER TABLE "research_revision" ADD COLUMN "research_claim_id" uuid;--> statement-breakpoint
ALTER TABLE "claim_locus" ADD CONSTRAINT "claim_locus_claim_id_research_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."research_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_score" ADD CONSTRAINT "claim_score_claim_id_research_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."research_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_claim_embedding" ADD CONSTRAINT "research_claim_embedding_claim_id_research_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."research_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_claim" ADD CONSTRAINT "research_claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_claim" ADD CONSTRAINT "research_claim_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_claim" ADD CONSTRAINT "research_claim_corpus_item_id_research_corpus_item_id_fk" FOREIGN KEY ("corpus_item_id") REFERENCES "public"."research_corpus_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_claim" ADD CONSTRAINT "research_claim_processing_run_id_processing_run_id_fk" FOREIGN KEY ("processing_run_id") REFERENCES "public"."processing_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_claim" ADD CONSTRAINT "research_claim_text_block_id_text_block_id_fk" FOREIGN KEY ("text_block_id") REFERENCES "public"."text_block"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_corpus_item" ADD CONSTRAINT "research_corpus_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_locus_locus_key_idx" ON "claim_locus" USING btree ("locus_key");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_locus_claim_key_origin_unique" ON "claim_locus" USING btree ("claim_id","locus_key","origin");--> statement-breakpoint
CREATE INDEX "claim_score_claim_idx" ON "claim_score" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_score_claim_dimension_version_unique" ON "claim_score" USING btree ("claim_id","dimension","scorer_version");--> statement-breakpoint
CREATE INDEX "research_claim_embedding_claim_idx" ON "research_claim_embedding" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_claim_embedding_claim_model_hash_unique" ON "research_claim_embedding" USING btree ("claim_id","model","input_hash");--> statement-breakpoint
CREATE INDEX "research_claim_embedding_hnsw_idx" ON "research_claim_embedding" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "research_claim_user_idx" ON "research_claim" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "research_claim_work_idx" ON "research_claim" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "research_claim_corpus_item_idx" ON "research_claim" USING btree ("corpus_item_id");--> statement-breakpoint
CREATE INDEX "research_claim_text_block_idx" ON "research_claim" USING btree ("text_block_id");--> statement-breakpoint
CREATE INDEX "research_claim_user_status_idx" ON "research_claim" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "research_claim_work_dedup_unique" ON "research_claim" USING btree ("work_id","content_hash","prompt_version") WHERE "research_claim"."work_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "research_claim_corpus_item_dedup_unique" ON "research_claim" USING btree ("corpus_item_id","content_hash","prompt_version") WHERE "research_claim"."corpus_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "research_corpus_item_user_idx" ON "research_corpus_item" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "research_corpus_item_source_external_idx" ON "research_corpus_item" USING btree ("source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_corpus_item_user_dedup_unique" ON "research_corpus_item" USING btree ("user_id","dedup_key");--> statement-breakpoint
ALTER TABLE "research_project_member" ADD CONSTRAINT "research_project_member_corpus_item_id_research_corpus_item_id_fk" FOREIGN KEY ("corpus_item_id") REFERENCES "public"."research_corpus_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_research_claim_id_research_claim_id_fk" FOREIGN KEY ("research_claim_id") REFERENCES "public"."research_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_project_member_corpus_item_idx" ON "research_project_member" USING btree ("corpus_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_project_member_corpus_item_unique" ON "research_project_member" USING btree ("project_id","corpus_item_id");--> statement-breakpoint
CREATE INDEX "research_revision_claim_idx" ON "research_revision" USING btree ("research_claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_revision_claim_revision_unique" ON "research_revision" USING btree ("research_claim_id","revision") WHERE "research_revision"."research_claim_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "research_project_member" ADD CONSTRAINT "research_project_member_typed_target" CHECK (("research_project_member"."member_type" = 'work' AND "research_project_member"."work_id" IS NOT NULL AND "research_project_member"."corpus_item_id" IS NULL AND "research_project_member"."writer_project_id" IS NULL AND "research_project_member"."rag_conversation_id" IS NULL)
        OR ("research_project_member"."member_type" = 'corpus_item' AND "research_project_member"."corpus_item_id" IS NOT NULL AND "research_project_member"."work_id" IS NULL AND "research_project_member"."writer_project_id" IS NULL AND "research_project_member"."rag_conversation_id" IS NULL)
        OR ("research_project_member"."member_type" = 'writer_project' AND "research_project_member"."writer_project_id" IS NOT NULL AND "research_project_member"."work_id" IS NULL AND "research_project_member"."corpus_item_id" IS NULL AND "research_project_member"."rag_conversation_id" IS NULL)
        OR ("research_project_member"."member_type" = 'rag_conversation' AND "research_project_member"."rag_conversation_id" IS NOT NULL AND "research_project_member"."work_id" IS NULL AND "research_project_member"."corpus_item_id" IS NULL AND "research_project_member"."writer_project_id" IS NULL));--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_typed_target" CHECK (("research_revision"."object_type" = 'claim' AND "research_revision"."research_claim_id" IS NOT NULL)
        OR ("research_revision"."object_type" <> 'claim' AND "research_revision"."research_claim_id" IS NULL));