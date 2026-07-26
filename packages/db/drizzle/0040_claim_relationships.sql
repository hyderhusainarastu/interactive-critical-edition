CREATE TYPE "public"."claim_engagement" AS ENUM('direct_citation', 'reciprocal_citation', 'shared_citation', 'none_detected');--> statement-breakpoint
CREATE TYPE "public"."claim_judge_branch" AS ENUM('empirical', 'humanities');--> statement-breakpoint
CREATE TYPE "public"."claim_relation_category" AS ENUM('methodological', 'findings', 'theoretical', 'scope');--> statement-breakpoint
CREATE TYPE "public"."claim_relation_mechanism" AS ENUM('unspecified');--> statement-breakpoint
CREATE TYPE "public"."claim_relation_valence" AS ENUM('contradiction', 'support', 'nuance', 'unrelated');--> statement-breakpoint
CREATE TYPE "public"."claim_side" AS ENUM('lo', 'hi', 'neither');--> statement-breakpoint
CREATE TABLE "claim_pair_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"claim_lo_id" uuid NOT NULL,
	"claim_hi_id" uuid NOT NULL,
	"retrieval_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"best_retrieval_score" real NOT NULL,
	"engagement" "claim_engagement" DEFAULT 'none_detected' NOT NULL,
	"engagement_evidence" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "claim_pair_candidate_lo_hi_order" CHECK ("claim_pair_candidate"."claim_lo_id" < "claim_pair_candidate"."claim_hi_id")
);
--> statement-breakpoint
CREATE TABLE "claim_relationship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"claim_lo_id" uuid NOT NULL,
	"claim_hi_id" uuid NOT NULL,
	"valence" "claim_relation_valence" NOT NULL,
	"category" "claim_relation_category" NOT NULL,
	"mechanism" "claim_relation_mechanism",
	"judge_branch" "claim_judge_branch" NOT NULL,
	"stronger_side" "claim_side" DEFAULT 'neither' NOT NULL,
	"explanation" text NOT NULL,
	"resolution" text NOT NULL,
	"engagement" "claim_engagement" NOT NULL,
	"evidence_gap" real,
	"evidence_gap_dimension" "claim_score_dimension",
	"basis_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text,
	"model" text,
	"status" "research_object_status" DEFAULT 'active' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unreviewed' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "claim_relationship_lo_hi_order" CHECK ("claim_relationship"."claim_lo_id" < "claim_relationship"."claim_hi_id"),
	CONSTRAINT "claim_relationship_mechanism_matches_valence" CHECK ("claim_relationship"."mechanism" IS NULL OR "claim_relationship"."mechanism" = 'unspecified'),
	CONSTRAINT "claim_relationship_gap_dimensioned" CHECK ("claim_relationship"."evidence_gap" IS NULL OR "claim_relationship"."evidence_gap_dimension" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "research_revision" DROP CONSTRAINT "research_revision_typed_target";--> statement-breakpoint
ALTER TABLE "research_revision" ADD COLUMN "claim_relationship_id" uuid;--> statement-breakpoint
ALTER TABLE "claim_pair_candidate" ADD CONSTRAINT "claim_pair_candidate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_pair_candidate" ADD CONSTRAINT "claim_pair_candidate_project_id_research_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."research_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_pair_candidate" ADD CONSTRAINT "claim_pair_candidate_claim_lo_id_research_claim_id_fk" FOREIGN KEY ("claim_lo_id") REFERENCES "public"."research_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_pair_candidate" ADD CONSTRAINT "claim_pair_candidate_claim_hi_id_research_claim_id_fk" FOREIGN KEY ("claim_hi_id") REFERENCES "public"."research_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_relationship" ADD CONSTRAINT "claim_relationship_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_relationship" ADD CONSTRAINT "claim_relationship_project_id_research_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."research_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_relationship" ADD CONSTRAINT "claim_relationship_claim_lo_id_research_claim_id_fk" FOREIGN KEY ("claim_lo_id") REFERENCES "public"."research_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_relationship" ADD CONSTRAINT "claim_relationship_claim_hi_id_research_claim_id_fk" FOREIGN KEY ("claim_hi_id") REFERENCES "public"."research_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_pair_candidate_project_idx" ON "claim_pair_candidate" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "claim_pair_candidate_lo_idx" ON "claim_pair_candidate" USING btree ("claim_lo_id");--> statement-breakpoint
CREATE INDEX "claim_pair_candidate_hi_idx" ON "claim_pair_candidate" USING btree ("claim_hi_id");--> statement-breakpoint
CREATE INDEX "claim_pair_candidate_user_idx" ON "claim_pair_candidate" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_pair_candidate_user_lo_hi_unique" ON "claim_pair_candidate" USING btree ("user_id","claim_lo_id","claim_hi_id");--> statement-breakpoint
CREATE INDEX "claim_relationship_project_idx" ON "claim_relationship" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "claim_relationship_lo_idx" ON "claim_relationship" USING btree ("claim_lo_id");--> statement-breakpoint
CREATE INDEX "claim_relationship_hi_idx" ON "claim_relationship" USING btree ("claim_hi_id");--> statement-breakpoint
CREATE INDEX "claim_relationship_user_status_idx" ON "claim_relationship" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_relationship_user_lo_hi_basis_unique" ON "claim_relationship" USING btree ("user_id","claim_lo_id","claim_hi_id","basis_hash");--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_claim_relationship_id_claim_relationship_id_fk" FOREIGN KEY ("claim_relationship_id") REFERENCES "public"."claim_relationship"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_revision_relationship_idx" ON "research_revision" USING btree ("claim_relationship_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_revision_relationship_revision_unique" ON "research_revision" USING btree ("claim_relationship_id","revision") WHERE "research_revision"."claim_relationship_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_typed_target" CHECK (("research_revision"."object_type" = 'claim' AND "research_revision"."research_claim_id" IS NOT NULL AND "research_revision"."claim_relationship_id" IS NULL)
        OR ("research_revision"."object_type" = 'relationship' AND "research_revision"."claim_relationship_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL)
        OR ("research_revision"."object_type" NOT IN ('claim', 'relationship') AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL));