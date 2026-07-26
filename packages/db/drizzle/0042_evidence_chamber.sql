CREATE TYPE "public"."evidence_chamber_stance_confidence_label" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "evidence_chamber_position_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"excerpt" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_chamber_position_claim_excerpt_nonempty" CHECK (char_length(trim("evidence_chamber_position_claim"."excerpt")) > 0)
);
--> statement-breakpoint
CREATE TABLE "evidence_chamber_position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chamber_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"summary" text NOT NULL,
	"method" text NOT NULL,
	"scope" text NOT NULL,
	"stance_confidence_label" "evidence_chamber_stance_confidence_label" NOT NULL,
	"stance_confidence" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_chamber_position_stance_confidence_range" CHECK ("evidence_chamber_position"."stance_confidence" >= 0 AND "evidence_chamber_position"."stance_confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "evidence_chamber" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"cluster_id" uuid NOT NULL,
	"question" text NOT NULL,
	"shared_ground" text NOT NULL,
	"point_of_divergence" text NOT NULL,
	"possible_reconciliation" text NOT NULL,
	"unresolved_question" text NOT NULL,
	"missing_evidence" text NOT NULL,
	"next_action" text NOT NULL,
	"basis_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "research_object_status" DEFAULT 'active' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unreviewed' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_revision" DROP CONSTRAINT "research_revision_typed_target";--> statement-breakpoint
ALTER TABLE "research_revision" ADD COLUMN "evidence_chamber_id" uuid;--> statement-breakpoint
ALTER TABLE "research_revision" ADD COLUMN "evidence_chamber_position_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_chamber_position_claim" ADD CONSTRAINT "evidence_chamber_position_claim_position_id_evidence_chamber_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."evidence_chamber_position"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_chamber_position_claim" ADD CONSTRAINT "evidence_chamber_position_claim_claim_id_research_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."research_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_chamber_position" ADD CONSTRAINT "evidence_chamber_position_chamber_id_evidence_chamber_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."evidence_chamber"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_chamber" ADD CONSTRAINT "evidence_chamber_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_chamber" ADD CONSTRAINT "evidence_chamber_project_id_research_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."research_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_chamber" ADD CONSTRAINT "evidence_chamber_cluster_id_debate_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."debate_cluster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_chamber_position_claim_position_idx" ON "evidence_chamber_position_claim" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "evidence_chamber_position_claim_claim_idx" ON "evidence_chamber_position_claim" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_chamber_position_claim_position_claim_unique" ON "evidence_chamber_position_claim" USING btree ("position_id","claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_chamber_position_claim_position_ordinal_unique" ON "evidence_chamber_position_claim" USING btree ("position_id","ordinal");--> statement-breakpoint
CREATE INDEX "evidence_chamber_position_chamber_idx" ON "evidence_chamber_position" USING btree ("chamber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_chamber_position_chamber_ordinal_unique" ON "evidence_chamber_position" USING btree ("chamber_id","ordinal");--> statement-breakpoint
CREATE INDEX "evidence_chamber_project_idx" ON "evidence_chamber" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "evidence_chamber_cluster_idx" ON "evidence_chamber" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "evidence_chamber_user_status_idx" ON "evidence_chamber" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_chamber_user_cluster_basis_unique" ON "evidence_chamber" USING btree ("user_id","cluster_id","basis_hash");--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_evidence_chamber_id_evidence_chamber_id_fk" FOREIGN KEY ("evidence_chamber_id") REFERENCES "public"."evidence_chamber"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_evidence_chamber_position_id_evidence_chamber_position_id_fk" FOREIGN KEY ("evidence_chamber_position_id") REFERENCES "public"."evidence_chamber_position"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_revision_chamber_idx" ON "research_revision" USING btree ("evidence_chamber_id");--> statement-breakpoint
CREATE INDEX "research_revision_position_idx" ON "research_revision" USING btree ("evidence_chamber_position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_revision_chamber_revision_unique" ON "research_revision" USING btree ("evidence_chamber_id","revision") WHERE "research_revision"."evidence_chamber_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "research_revision_position_revision_unique" ON "research_revision" USING btree ("evidence_chamber_position_id","revision") WHERE "research_revision"."evidence_chamber_position_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_typed_target" CHECK (("research_revision"."object_type" = 'claim' AND "research_revision"."research_claim_id" IS NOT NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL AND "research_revision"."evidence_chamber_id" IS NULL AND "research_revision"."evidence_chamber_position_id" IS NULL)
        OR ("research_revision"."object_type" = 'relationship' AND "research_revision"."claim_relationship_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL AND "research_revision"."evidence_chamber_id" IS NULL AND "research_revision"."evidence_chamber_position_id" IS NULL)
        OR ("research_revision"."object_type" = 'cluster' AND "research_revision"."debate_cluster_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."evidence_chamber_id" IS NULL AND "research_revision"."evidence_chamber_position_id" IS NULL)
        OR ("research_revision"."object_type" = 'chamber' AND "research_revision"."evidence_chamber_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL AND "research_revision"."evidence_chamber_position_id" IS NULL)
        OR ("research_revision"."object_type" = 'position' AND "research_revision"."evidence_chamber_position_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL AND "research_revision"."evidence_chamber_id" IS NULL)
        OR ("research_revision"."object_type" NOT IN ('claim', 'relationship', 'cluster', 'chamber', 'position') AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL AND "research_revision"."evidence_chamber_id" IS NULL AND "research_revision"."evidence_chamber_position_id" IS NULL));