CREATE TYPE "public"."term_verification_status" AS ENUM('suggested', 'verified');--> statement-breakpoint
CREATE TABLE "note_highlight" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"highlight_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "term_occurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_variant_id" uuid NOT NULL,
	"text_block_id" uuid NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "term_occurrence_offsets_valid" CHECK ("term_occurrence"."start_offset" >= 0 AND "term_occurrence"."end_offset" > "term_occurrence"."start_offset")
);
--> statement-breakpoint
CREATE TABLE "term_variant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"original_script" text NOT NULL,
	"transliteration" text NOT NULL,
	"language" text NOT NULL,
	"direction" text DEFAULT 'ltr' NOT NULL,
	"verification_status" "term_verification_status" DEFAULT 'suggested' NOT NULL,
	"source" text DEFAULT 'system' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_highlight" ADD CONSTRAINT "note_highlight_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_highlight" ADD CONSTRAINT "note_highlight_highlight_id_highlight_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."highlight"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_occurrence" ADD CONSTRAINT "term_occurrence_term_variant_id_term_variant_id_fk" FOREIGN KEY ("term_variant_id") REFERENCES "public"."term_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_occurrence" ADD CONSTRAINT "term_occurrence_text_block_id_text_block_id_fk" FOREIGN KEY ("text_block_id") REFERENCES "public"."text_block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_variant" ADD CONSTRAINT "term_variant_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_variant" ADD CONSTRAINT "term_variant_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_highlight_unique" ON "note_highlight" USING btree ("note_id","highlight_id");--> statement-breakpoint
INSERT INTO "note_highlight" ("note_id", "highlight_id")
SELECT "id", "highlight_id" FROM "note" WHERE "highlight_id" IS NOT NULL
ON CONFLICT ("note_id", "highlight_id") DO NOTHING;--> statement-breakpoint
CREATE INDEX "note_highlight_highlight_idx" ON "note_highlight" USING btree ("highlight_id");--> statement-breakpoint
CREATE INDEX "term_occurrence_block_idx" ON "term_occurrence" USING btree ("text_block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "term_occurrence_unique" ON "term_occurrence" USING btree ("term_variant_id","text_block_id","start_offset","end_offset");--> statement-breakpoint
CREATE INDEX "term_variant_document_idx" ON "term_variant" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "term_variant_status_idx" ON "term_variant" USING btree ("document_id","verification_status");--> statement-breakpoint
CREATE UNIQUE INDEX "term_variant_document_pair_unique" ON "term_variant" USING btree ("document_id","original_script","transliteration");
