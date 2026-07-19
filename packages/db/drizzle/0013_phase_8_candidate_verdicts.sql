CREATE TYPE "public"."candidate_verdict" AS ENUM('accepted', 'quarantined', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."query_lane" AS ENUM('explicit_citation', 'primary_prerequisite', 'historical_background', 'concept_doctrine', 'scholarly_debate', 'author_corpus', 'reception_citation', 'parallel_literature', 'lecture_course', 'video_podcast', 'blog_newsletter', 'public_discussion');--> statement-breakpoint
CREATE TABLE "research_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"lane" "query_lane" NOT NULL,
	"query" text,
	"provider" text NOT NULL,
	"title" text NOT NULL,
	"authors" jsonb,
	"year" integer,
	"doi" text,
	"isbn" text,
	"canonical_url" text,
	"venue" text,
	"normalized_key" text,
	"verdict" "candidate_verdict" NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"reasons" jsonb,
	"signals" jsonb,
	"venue_reliable" boolean DEFAULT true NOT NULL,
	"resource_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_candidate" ADD CONSTRAINT "research_candidate_run_id_processing_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_candidate" ADD CONSTRAINT "research_candidate_resource_id_research_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."research_resource"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_candidate_run_idx" ON "research_candidate" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "research_candidate_verdict_idx" ON "research_candidate" USING btree ("run_id","verdict");--> statement-breakpoint
CREATE INDEX "research_candidate_lane_idx" ON "research_candidate" USING btree ("run_id","lane");--> statement-breakpoint
CREATE UNIQUE INDEX "research_candidate_run_lane_key_unique" ON "research_candidate" USING btree ("run_id","lane","normalized_key");