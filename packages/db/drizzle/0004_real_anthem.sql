CREATE TYPE "public"."access_status" AS ENUM('open', 'subscription', 'metadata_only', 'user_uploaded', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."analysis_status" AS ENUM('not_started', 'analyzing', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."edge_type" AS ENUM('cites', 'quotes', 'influences', 'criticizes', 'responds_to', 'presupposes', 'provides_context_for', 'interprets', 'disagrees_with', 'translates', 'is_edition_of', 'is_prerequisite_for', 'is_comparable_to', 'is_recommended_by');--> statement-breakpoint
CREATE TYPE "public"."provenance_source" AS ENUM('system', 'user', 'editor');--> statement-breakpoint
CREATE TYPE "public"."relationship_category" AS ENUM('explicit_reference', 'secondary_scholarly_recommendation', 'historical_context', 'prerequisite', 'conceptual_influence', 'disagreement_polemical_target', 'interpretive_aid', 'parallel_comparison', 'optional_extension', 'ai_inferred');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unreviewed', 'user_verified', 'source_verified', 'disputed', 'rejected');--> statement-breakpoint
CREATE TABLE "ai_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"relationship_category" "relationship_category" NOT NULL,
	"target_bib_id" uuid,
	"target_label" text NOT NULL,
	"anchor" jsonb,
	"extracted_source_text" text,
	"explanation" text NOT NULL,
	"confidence" real NOT NULL,
	"model_used" text,
	"prompt_version" text,
	"created_by" "provenance_source" DEFAULT 'system' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unreviewed' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bibliographic_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"authors" text,
	"year" integer,
	"doi" text,
	"url" text,
	"access_status" "access_status" DEFAULT 'metadata_only' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "citation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"resolved_bib_id" uuid,
	"resolution_source" text DEFAULT 'unresolved' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_edge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"edge_type" "edge_type" NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"evidence" jsonb,
	"verification_status" "verification_status" DEFAULT 'unreviewed' NOT NULL,
	"created_by" "provenance_source" DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "analysis_status" "analysis_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "analysis_error" text;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation" ADD CONSTRAINT "annotation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation" ADD CONSTRAINT "annotation_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation" ADD CONSTRAINT "annotation_target_bib_id_bibliographic_record_id_fk" FOREIGN KEY ("target_bib_id") REFERENCES "public"."bibliographic_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_resolved_bib_id_bibliographic_record_id_fk" FOREIGN KEY ("resolved_bib_id") REFERENCES "public"."bibliographic_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edge" ADD CONSTRAINT "graph_edge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;