CREATE TYPE "public"."processing_run_status" AS ENUM('pending', 'running', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."text_block_kind" AS ENUM('title', 'header', 'body', 'footer', 'footnote', 'caption', 'bibliography', 'reference');--> statement-breakpoint
CREATE TABLE "doc_footnote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"marker" text NOT NULL,
	"page_anchor" jsonb,
	"text" text NOT NULL,
	"kind" text DEFAULT 'authorial' NOT NULL,
	"source" text DEFAULT 'grobid' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"title" text,
	"authors" jsonb,
	"confidence" real DEFAULT 0 NOT NULL,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"page_index" integer NOT NULL,
	"width" real,
	"height" real,
	"image_path" text,
	"is_ocr" boolean DEFAULT false NOT NULL,
	"extraction_confidence" real,
	"text" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"pipeline_version" text DEFAULT 'v2' NOT NULL,
	"status" "processing_run_status" DEFAULT 'pending' NOT NULL,
	"stage" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"note" text,
	"error" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "text_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"block_order" integer NOT NULL,
	"kind" text_block_kind DEFAULT 'body' NOT NULL,
	"bbox" jsonb,
	"text" text NOT NULL,
	"confidence" real
);
--> statement-breakpoint
ALTER TABLE "doc_footnote" ADD CONSTRAINT "doc_footnote_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_metadata" ADD CONSTRAINT "doc_metadata_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_run" ADD CONSTRAINT "processing_run_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_block" ADD CONSTRAINT "text_block_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_footnote_run_idx" ON "doc_footnote" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "page_run_idx" ON "page" USING btree ("run_id","page_index");--> statement-breakpoint
CREATE INDEX "processing_run_document_idx" ON "processing_run" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "processing_run_published_idx" ON "processing_run" USING btree ("document_id","is_published");--> statement-breakpoint
CREATE INDEX "text_block_page_idx" ON "text_block" USING btree ("page_id","block_order");