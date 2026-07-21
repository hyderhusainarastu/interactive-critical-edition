CREATE TYPE "public"."research_resource_content_status" AS ENUM('metadata_only', 'open_access_available', 'open_access_indexed', 'retrieval_failed');--> statement-breakpoint
CREATE TABLE "research_resource_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"status" "research_resource_content_status" DEFAULT 'metadata_only' NOT NULL,
	"source_url" text,
	"license" text,
	"license_evidence" jsonb,
	"text" text,
	"content_hash" text,
	"retrieved_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "research_resource_content_resource_unique" UNIQUE("resource_id")
);
--> statement-breakpoint
ALTER TABLE "research_resource_content" ADD CONSTRAINT "research_resource_content_resource_id_research_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."research_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_resource_content_status_idx" ON "research_resource_content" USING btree ("status");
