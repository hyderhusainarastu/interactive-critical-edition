CREATE TYPE "public"."record_role" AS ENUM('primary', 'review', 'edition', 'translation', 'excerpt');--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "work_key" text;--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "work_role" "record_role" DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "work_canonical_title" text;--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "work_author_surname" text;--> statement-breakpoint
ALTER TABLE "research_resource" ADD COLUMN "work_evidence" text;--> statement-breakpoint
CREATE INDEX "research_resource_work_idx" ON "research_resource" USING btree ("run_id","work_key");