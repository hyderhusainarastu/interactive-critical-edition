CREATE TYPE "public"."foreign_direction" AS ENUM('ltr', 'rtl');--> statement-breakpoint
CREATE TYPE "public"."foreign_language_basis" AS ENUM('script_range', 'model_validated', 'human_verified');--> statement-breakpoint
CREATE TYPE "public"."foreign_script" AS ENUM('greek', 'hebrew', 'arabic', 'cyrillic', 'cjk');--> statement-breakpoint
CREATE TYPE "public"."foreign_span_deferred_reason" AS ENUM('provider_unavailable', 'budget_exhausted', 'invalid_model_response', 'batch_limit');--> statement-breakpoint
CREATE TYPE "public"."foreign_span_provenance_kind" AS ENUM('source_text', 'ocr_recovery', 'pdf_glyph_recovery', 'manual');--> statement-breakpoint
CREATE TYPE "public"."foreign_span_status" AS ENUM('pending', 'resolved', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."foreign_transcription_status" AS ENUM('legitimate', 'recovered');--> statement-breakpoint
CREATE TABLE "foreign_span" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"text_block_id" uuid NOT NULL,
	"source_text" text NOT NULL,
	"original_text" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"script" "foreign_script" NOT NULL,
	"language_hint" text NOT NULL,
	"language_code" text,
	"language_label" text,
	"language_basis" "foreign_language_basis" DEFAULT 'script_range' NOT NULL,
	"direction" "foreign_direction" NOT NULL,
	"source_provenance_kind" "foreign_span_provenance_kind" NOT NULL,
	"source_provenance_label" text NOT NULL,
	"source_confidence" real NOT NULL,
	"transcription_status" "foreign_transcription_status" DEFAULT 'legitimate' NOT NULL,
	"transliteration" text,
	"translation" text,
	"translation_provenance" text,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"cache_key" text,
	"status" "foreign_span_status" DEFAULT 'pending' NOT NULL,
	"deferred_reason" "foreign_span_deferred_reason",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "foreign_span_offsets_valid" CHECK ("foreign_span"."start_offset" >= 0 AND "foreign_span"."end_offset" > "foreign_span"."start_offset"),
	CONSTRAINT "foreign_span_source_confidence_valid" CHECK ("foreign_span"."source_confidence" >= 0 AND "foreign_span"."source_confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "foreign_span" ADD CONSTRAINT "foreign_span_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreign_span" ADD CONSTRAINT "foreign_span_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreign_span" ADD CONSTRAINT "foreign_span_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreign_span" ADD CONSTRAINT "foreign_span_text_block_id_text_block_id_fk" FOREIGN KEY ("text_block_id") REFERENCES "public"."text_block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "foreign_span_user_idx" ON "foreign_span" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "foreign_span_document_idx" ON "foreign_span" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "foreign_span_block_idx" ON "foreign_span" USING btree ("text_block_id");--> statement-breakpoint
CREATE INDEX "foreign_span_status_run_idx" ON "foreign_span" USING btree ("status","run_id");--> statement-breakpoint
CREATE INDEX "foreign_span_cache_key_resolved_idx" ON "foreign_span" USING btree ("cache_key") WHERE "foreign_span"."status" = 'resolved';--> statement-breakpoint
CREATE UNIQUE INDEX "foreign_span_document_block_source_unique" ON "foreign_span" USING btree ("document_id","text_block_id","source_text");--> statement-breakpoint
CREATE UNIQUE INDEX "foreign_span_run_block_offsets_unique" ON "foreign_span" USING btree ("run_id","text_block_id","start_offset","end_offset");