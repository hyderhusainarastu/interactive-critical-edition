CREATE TYPE "public"."concept_kind" AS ENUM('concept', 'doctrine', 'person', 'tradition', 'debate');--> statement-breakpoint
CREATE TYPE "public"."mastery_source" AS ENUM('explicit', 'diagnostic', 'inferred');--> statement-breakpoint
CREATE TYPE "public"."reader_level" AS ENUM('beginner', 'undergraduate', 'advanced', 'research');--> statement-breakpoint
CREATE TABLE "concept_mastery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"source" "mastery_source" NOT NULL,
	"evidence" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "concept_kind" DEFAULT 'concept' NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"summary" text,
	"aliases" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "concept_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "learning_resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_identity_id" uuid,
	"title" text NOT NULL,
	"url" text,
	"canonical_url" text,
	"doi" text,
	"isbn" text,
	"normalized_key" text NOT NULL,
	"resource_type" text DEFAULT 'bibliographic' NOT NULL,
	"provider" text NOT NULL,
	"year" integer,
	"authors" jsonb,
	"venue" text,
	"creator" jsonb,
	"peer_reviewed" boolean,
	"popularity" jsonb,
	"bib_record_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_resource_normalized_key_unique" UNIQUE("normalized_key")
);
--> statement-breakpoint
CREATE TABLE "resource_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learning_resource_id" uuid NOT NULL,
	"work_identity_id" uuid NOT NULL,
	"relationship" "relationship_category" NOT NULL,
	"reader_level" "reader_level",
	"rationale" text,
	"confidence" real DEFAULT 0 NOT NULL,
	"created_by" "provenance_source" DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resource_role_unique" UNIQUE NULLS NOT DISTINCT("learning_resource_id","work_identity_id","reader_level")
);
--> statement-breakpoint
CREATE TABLE "work_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_key" text NOT NULL,
	"canonical_title" text NOT NULL,
	"author_surname" text,
	"authors" jsonb,
	"year" integer,
	"evidence" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_identity_work_key_unique" UNIQUE("work_key")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "reader_level" "reader_level";--> statement-breakpoint
ALTER TABLE "concept_mastery" ADD CONSTRAINT "concept_mastery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_mastery" ADD CONSTRAINT "concept_mastery_concept_id_concept_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resource" ADD CONSTRAINT "learning_resource_work_identity_id_work_identity_id_fk" FOREIGN KEY ("work_identity_id") REFERENCES "public"."work_identity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resource" ADD CONSTRAINT "learning_resource_bib_record_id_bibliographic_record_id_fk" FOREIGN KEY ("bib_record_id") REFERENCES "public"."bibliographic_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_role" ADD CONSTRAINT "resource_role_learning_resource_id_learning_resource_id_fk" FOREIGN KEY ("learning_resource_id") REFERENCES "public"."learning_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_role" ADD CONSTRAINT "resource_role_work_identity_id_work_identity_id_fk" FOREIGN KEY ("work_identity_id") REFERENCES "public"."work_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concept_mastery_user_idx" ON "concept_mastery" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_mastery_user_concept_unique" ON "concept_mastery" USING btree ("user_id","concept_id");--> statement-breakpoint
CREATE INDEX "concept_kind_idx" ON "concept" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "learning_resource_work_idx" ON "learning_resource" USING btree ("work_identity_id");--> statement-breakpoint
CREATE INDEX "resource_role_work_idx" ON "resource_role" USING btree ("work_identity_id");--> statement-breakpoint
CREATE INDEX "resource_role_resource_idx" ON "resource_role" USING btree ("learning_resource_id");--> statement-breakpoint
-- Backfill the new four-level reader_level from the three-level
-- preferences.expertise chosen at onboarding, mapping intermediate ->
-- undergraduate (plan §34.3). This MIGRATES the value rather than adding a
-- parallel field: the jsonb key stays only until 9.4 moves the readers over,
-- and is not written to again. A user who never chose one stays NULL, which
-- means "not chosen" — not a level we invented on their behalf.
UPDATE "user"
SET "reader_level" = CASE "preferences"->>'expertise'
    WHEN 'beginner' THEN 'beginner'::"public"."reader_level"
    WHEN 'intermediate' THEN 'undergraduate'::"public"."reader_level"
    WHEN 'advanced' THEN 'advanced'::"public"."reader_level"
  END
WHERE "preferences"->>'expertise' IN ('beginner', 'intermediate', 'advanced');
