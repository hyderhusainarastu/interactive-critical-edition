CREATE TYPE "public"."research_monitor_cadence" AS ENUM('daily', 'weekly', 'paused');--> statement-breakpoint
CREATE TYPE "public"."research_monitor_type" AS ENUM('topic', 'citation_alert', 'author_follow');--> statement-breakpoint
CREATE TABLE "research_monitor_hit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"dedup_key" text NOT NULL,
	"title" text NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"year" integer,
	"venue" text,
	"url" text,
	"provider" text NOT NULL,
	"seen_at" timestamp DEFAULT now() NOT NULL,
	"dismissed_at" timestamp,
	"imported_corpus_item_id" uuid
);
--> statement-breakpoint
CREATE TABLE "research_monitor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"monitor_type" "research_monitor_type" NOT NULL,
	"query" text NOT NULL,
	"cadence" "research_monitor_cadence" DEFAULT 'paused' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_scanned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_monitor_hit" ADD CONSTRAINT "research_monitor_hit_monitor_id_research_monitor_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."research_monitor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_monitor_hit" ADD CONSTRAINT "research_monitor_hit_imported_corpus_item_id_research_corpus_item_id_fk" FOREIGN KEY ("imported_corpus_item_id") REFERENCES "public"."research_corpus_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_monitor" ADD CONSTRAINT "research_monitor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_monitor" ADD CONSTRAINT "research_monitor_project_id_research_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."research_project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_monitor_hit_monitor_idx" ON "research_monitor_hit" USING btree ("monitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_monitor_hit_monitor_dedup_unique" ON "research_monitor_hit" USING btree ("monitor_id","dedup_key");--> statement-breakpoint
CREATE INDEX "research_monitor_user_cadence_idx" ON "research_monitor" USING btree ("user_id","cadence");--> statement-breakpoint
CREATE INDEX "research_monitor_project_idx" ON "research_monitor" USING btree ("project_id");