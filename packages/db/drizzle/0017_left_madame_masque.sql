CREATE TYPE "public"."passage_annotation_type" AS ENUM('context', 'clarification', 'connection', 'critique', 'definition');--> statement-breakpoint
CREATE TABLE "passage_annotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"text_block_id" uuid,
	"is_whole_work" boolean DEFAULT false NOT NULL,
	"quote" text,
	"summary" text NOT NULL,
	"explanation" text NOT NULL,
	"annotation_type" "passage_annotation_type" NOT NULL,
	"relationship" "relationship_category" NOT NULL,
	"reader_level" "reader_level",
	"confidence" real DEFAULT 0 NOT NULL,
	"related_resource_id" uuid,
	"created_by" "provenance_source" DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passage_annotation_anchor_or_whole_work" CHECK (("passage_annotation"."is_whole_work" = true AND "passage_annotation"."text_block_id" IS NULL) OR ("passage_annotation"."is_whole_work" = false AND "passage_annotation"."text_block_id" IS NOT NULL AND "passage_annotation"."quote" IS NOT NULL)),
	CONSTRAINT "passage_annotation_summary_length" CHECK (char_length("passage_annotation"."summary") <= 240)
);
--> statement-breakpoint
ALTER TABLE "passage_annotation" ADD CONSTRAINT "passage_annotation_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passage_annotation" ADD CONSTRAINT "passage_annotation_text_block_id_text_block_id_fk" FOREIGN KEY ("text_block_id") REFERENCES "public"."text_block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passage_annotation" ADD CONSTRAINT "passage_annotation_related_resource_id_research_resource_id_fk" FOREIGN KEY ("related_resource_id") REFERENCES "public"."research_resource"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passage_annotation_run_idx" ON "passage_annotation" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "passage_annotation_block_idx" ON "passage_annotation" USING btree ("text_block_id");