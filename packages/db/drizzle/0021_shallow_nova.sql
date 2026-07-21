CREATE TYPE "public"."author_apparatus_kind" AS ENUM('footnote', 'endnote', 'bibliography_entry', 'citation_block');--> statement-breakpoint
ALTER TYPE "public"."passage_annotation_type" ADD VALUE 'key_term';--> statement-breakpoint
ALTER TYPE "public"."passage_annotation_type" ADD VALUE 'concept';--> statement-breakpoint
ALTER TYPE "public"."passage_annotation_type" ADD VALUE 'argument';--> statement-breakpoint
ALTER TYPE "public"."passage_annotation_type" ADD VALUE 'evidence';--> statement-breakpoint
ALTER TYPE "public"."passage_annotation_type" ADD VALUE 'relationship';--> statement-breakpoint
CREATE TABLE "document_apparatus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"text_block_id" uuid,
	"kind" "author_apparatus_kind" NOT NULL,
	"marker" text,
	"text" text NOT NULL,
	"scope" jsonb,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"text_block_id" uuid,
	"claim" text NOT NULL,
	"claim_type" text NOT NULL,
	"supporting_excerpt" text NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_embedding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_relationship_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_work_id" uuid NOT NULL,
	"target_work_id" uuid NOT NULL,
	"method" text NOT NULL,
	"score" real NOT NULL,
	"basis" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_relationship_candidate_distinct_works" CHECK ("work_relationship_candidate"."source_work_id" <> "work_relationship_candidate"."target_work_id")
);
--> statement-breakpoint
ALTER TABLE "passage_annotation" ADD COLUMN "helpful_for" text;--> statement-breakpoint
ALTER TABLE "passage_annotation" ADD COLUMN "scope" jsonb;--> statement-breakpoint
ALTER TABLE "document_apparatus" ADD CONSTRAINT "document_apparatus_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_apparatus" ADD CONSTRAINT "document_apparatus_text_block_id_text_block_id_fk" FOREIGN KEY ("text_block_id") REFERENCES "public"."text_block"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_claim" ADD CONSTRAINT "work_claim_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_claim" ADD CONSTRAINT "work_claim_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_claim" ADD CONSTRAINT "work_claim_text_block_id_text_block_id_fk" FOREIGN KEY ("text_block_id") REFERENCES "public"."text_block"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_embedding" ADD CONSTRAINT "work_embedding_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_embedding" ADD CONSTRAINT "work_embedding_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_relationship_candidate" ADD CONSTRAINT "work_relationship_candidate_source_work_id_work_id_fk" FOREIGN KEY ("source_work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_relationship_candidate" ADD CONSTRAINT "work_relationship_candidate_target_work_id_work_id_fk" FOREIGN KEY ("target_work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_apparatus_run_idx" ON "document_apparatus" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "document_apparatus_kind_idx" ON "document_apparatus" USING btree ("run_id","kind");--> statement-breakpoint
CREATE INDEX "document_apparatus_block_idx" ON "document_apparatus" USING btree ("text_block_id");--> statement-breakpoint
CREATE INDEX "work_claim_run_idx" ON "work_claim" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "work_claim_work_idx" ON "work_claim" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "work_embedding_work_idx" ON "work_embedding" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_embedding_work_model_input_unique" ON "work_embedding" USING btree ("work_id","model","input_hash");--> statement-breakpoint
CREATE INDEX "work_relationship_candidate_source_idx" ON "work_relationship_candidate" USING btree ("source_work_id");--> statement-breakpoint
CREATE INDEX "work_relationship_candidate_target_idx" ON "work_relationship_candidate" USING btree ("target_work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_relationship_candidate_unique" ON "work_relationship_candidate" USING btree ("source_work_id","target_work_id","method");