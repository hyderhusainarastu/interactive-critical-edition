CREATE TYPE "public"."citation_resolution_state" AS ENUM('pending', 'resolved', 'unresolved');--> statement-breakpoint
CREATE TYPE "public"."citation_source_type" AS ENUM('bibliography', 'footnote', 'endnote', 'inline');--> statement-breakpoint
CREATE TABLE "citation_library_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citation_id" uuid NOT NULL,
	"learning_resource_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "citation_library_link_citation_id_unique" UNIQUE("citation_id")
);
--> statement-breakpoint
ALTER TABLE "citation" ADD COLUMN "processing_run_id" uuid;--> statement-breakpoint
ALTER TABLE "citation" ADD COLUMN "text_block_id" uuid;--> statement-breakpoint
ALTER TABLE "citation" ADD COLUMN "normalized_query" text;--> statement-breakpoint
ALTER TABLE "citation" ADD COLUMN "source_type" "citation_source_type" DEFAULT 'inline' NOT NULL;--> statement-breakpoint
ALTER TABLE "citation" ADD COLUMN "parser_confidence" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "citation" ADD COLUMN "source_anchor" jsonb;--> statement-breakpoint
ALTER TABLE "citation" ADD COLUMN "resolution_state" "citation_resolution_state" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
UPDATE "citation"
SET "normalized_query" = "raw_text",
    "resolution_state" = CASE WHEN "resolved_bib_id" IS NULL THEN 'unresolved'::"citation_resolution_state" ELSE 'resolved'::"citation_resolution_state" END;--> statement-breakpoint
ALTER TABLE "citation" ALTER COLUMN "normalized_query" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "citation_library_link" ADD CONSTRAINT "citation_library_link_citation_id_citation_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_library_link" ADD CONSTRAINT "citation_library_link_learning_resource_id_learning_resource_id_fk" FOREIGN KEY ("learning_resource_id") REFERENCES "public"."learning_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "citation_library_resource_idx" ON "citation_library_link" USING btree ("learning_resource_id");--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_processing_run_id_processing_run_id_fk" FOREIGN KEY ("processing_run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_text_block_id_text_block_id_fk" FOREIGN KEY ("text_block_id") REFERENCES "public"."text_block"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "citation_run_idx" ON "citation" USING btree ("processing_run_id");--> statement-breakpoint
CREATE INDEX "citation_block_idx" ON "citation" USING btree ("text_block_id");--> statement-breakpoint
CREATE INDEX "citation_source_type_idx" ON "citation" USING btree ("source_type");
