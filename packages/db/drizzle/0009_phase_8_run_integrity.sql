CREATE TYPE "public"."structure_state" AS ENUM('full', 'limited');--> statement-breakpoint
ALTER TABLE "processing_run" ADD COLUMN "structure_state" "structure_state" DEFAULT 'limited' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "processing_run_document_version_unique" ON "processing_run" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_metadata_run_unique" ON "doc_metadata" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "processing_run_one_published_per_document" ON "processing_run" USING btree ("document_id") WHERE "is_published"; 
