ALTER TABLE "ai_usage_log" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE set null;--> statement-breakpoint
CREATE TABLE "research_resource" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "title" text NOT NULL,
  "url" text,
  "resource_type" text DEFAULT 'bibliographic' NOT NULL,
  "provider" text NOT NULL,
  "access_status" text DEFAULT 'metadata_only' NOT NULL,
  "inspection_depth" integer DEFAULT 0 NOT NULL,
  "raw" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "resource_provenance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "query" text,
  "inspected_at" timestamp,
  "inspection_depth" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "edition_relation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "resource_id" uuid,
  "relation_type" text NOT NULL,
  "evidence" jsonb,
  "confidence" real DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "credibility_assessment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_id" uuid NOT NULL,
  "score" real NOT NULL,
  "rationale" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "evidence_span" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "resource_id" uuid,
  "page_anchor" jsonb,
  "quote" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "generated_note" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "evidence_span_id" uuid,
  "note_type" text DEFAULT 'critical' NOT NULL,
  "body" text NOT NULL,
  "confidence" real DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "research_resource" ADD CONSTRAINT "research_resource_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "resource_provenance" ADD CONSTRAINT "resource_provenance_resource_id_research_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."research_resource"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "edition_relation" ADD CONSTRAINT "edition_relation_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "edition_relation" ADD CONSTRAINT "edition_relation_resource_id_research_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."research_resource"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD CONSTRAINT "credibility_assessment_resource_id_research_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."research_resource"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "evidence_span" ADD CONSTRAINT "evidence_span_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "evidence_span" ADD CONSTRAINT "evidence_span_resource_id_research_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."research_resource"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "generated_note" ADD CONSTRAINT "generated_note_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "generated_note" ADD CONSTRAINT "generated_note_evidence_span_id_evidence_span_id_fk" FOREIGN KEY ("evidence_span_id") REFERENCES "public"."evidence_span"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "research_resource_run_idx" ON "research_resource" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "resource_provenance_resource_idx" ON "resource_provenance" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "edition_relation_run_idx" ON "edition_relation" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credibility_assessment_resource_unique" ON "credibility_assessment" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "evidence_span_run_idx" ON "evidence_span" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "generated_note_run_idx" ON "generated_note" USING btree ("run_id");
