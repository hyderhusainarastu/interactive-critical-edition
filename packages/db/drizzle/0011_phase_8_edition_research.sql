CREATE TYPE "public"."agreement_state" AS ENUM('strong', 'contested', 'mixed', 'insufficient');--> statement-breakpoint
CREATE TYPE "public"."provider_attempt_status" AS ENUM('queried', 'unavailable', 'rate_limited', 'failed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."source_authority" AS ENUM('A', 'B', 'C', 'D', 'E');--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"evidence_span_id" uuid NOT NULL,
	"stance" text DEFAULT 'supports' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"note_id" uuid,
	"text" text NOT NULL,
	"claim_type" text DEFAULT 'interpretive' NOT NULL,
	"agreement" "agreement_state" DEFAULT 'insufficient' NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" "provider_attempt_status" NOT NULL,
	"queries" jsonb,
	"result_count" integer DEFAULT 0 NOT NULL,
	"inspection_depth" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "authority" "source_authority";--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "relevance" real;--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "inspection_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "evidence_strength" real;--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "agreement" "agreement_state";--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "components" jsonb;--> statement-breakpoint
ALTER TABLE "edition_relation" ADD COLUMN "related_resource_id" uuid;--> statement-breakpoint
ALTER TABLE "edition_relation" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "edition_relation" ADD COLUMN "importance" real;--> statement-breakpoint
ALTER TABLE "processing_run" ADD COLUMN "ai_cost_usd" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_run" ADD COLUMN "degraded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_run" ADD COLUMN "saturation_note" text;--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "doi" text;--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "isbn" text;--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "canonical_url" text;--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "normalized_key" text;--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "authors" jsonb;--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "bib_record_id" uuid;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_generated_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."generated_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_evidence_span_id_evidence_span_id_fk" FOREIGN KEY ("evidence_span_id") REFERENCES "public"."evidence_span"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_claim" ADD CONSTRAINT "generated_claim_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_claim" ADD CONSTRAINT "generated_claim_note_id_generated_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."generated_note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_attempt" ADD CONSTRAINT "provider_attempt_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_evidence_unique" ON "claim_evidence" USING btree ("claim_id","evidence_span_id");--> statement-breakpoint
CREATE INDEX "generated_claim_run_idx" ON "generated_claim" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "generated_claim_note_idx" ON "generated_claim" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "provider_attempt_run_idx" ON "provider_attempt" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "edition_relation" ADD CONSTRAINT "edition_relation_related_resource_id_research_resource_id_fk" FOREIGN KEY ("related_resource_id") REFERENCES "public"."research_resource"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_resource" ADD CONSTRAINT "research_resource_bib_record_id_bibliographic_record_id_fk" FOREIGN KEY ("bib_record_id") REFERENCES "public"."bibliographic_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_resource_run_key_unique" ON "research_resource" USING btree ("run_id","normalized_key");