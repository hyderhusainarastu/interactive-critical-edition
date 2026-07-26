CREATE TYPE "public"."research_hypothesis_grounding" AS ENUM('detected_conflicts', 'single_work_gaps');--> statement-breakpoint
CREATE TYPE "public"."research_hypothesis_novelty_tier" AS ENUM('high', 'medium', 'low', 'unknown');--> statement-breakpoint
CREATE TABLE "research_gap" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"debate_cluster_id" uuid NOT NULL,
	"description" text NOT NULL,
	"unresolved_contradiction_count" integer NOT NULL,
	"status" "research_object_status" DEFAULT 'active' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unreviewed' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "research_gap_count_nonnegative" CHECK ("research_gap"."unresolved_contradiction_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "research_hypothesis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"question" text,
	"statement" text NOT NULL,
	"rationale" text NOT NULL,
	"methodology" text NOT NULL,
	"challenges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grounding" "research_hypothesis_grounding" DEFAULT 'detected_conflicts' NOT NULL,
	"novelty_distance" real,
	"novelty_tier" "research_hypothesis_novelty_tier",
	"novelty_embedding_model" text,
	"novelty_corpus" text,
	"run_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "research_object_status" DEFAULT 'active' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unreviewed' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "research_hypothesis_statement_nonempty" CHECK (char_length(trim("research_hypothesis"."statement")) > 0),
	CONSTRAINT "research_hypothesis_novelty_provenance" CHECK (("research_hypothesis"."novelty_tier" IS NULL AND "research_hypothesis"."novelty_embedding_model" IS NULL AND "research_hypothesis"."novelty_corpus" IS NULL)
        OR ("research_hypothesis"."novelty_tier" IS NOT NULL AND "research_hypothesis"."novelty_embedding_model" IS NOT NULL AND "research_hypothesis"."novelty_corpus" IS NOT NULL)),
	CONSTRAINT "research_hypothesis_novelty_distance_present" CHECK ("research_hypothesis"."novelty_tier" IS NULL OR "research_hypothesis"."novelty_tier" = 'unknown' OR "research_hypothesis"."novelty_distance" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "research_hypothesis_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hypothesis_id" uuid NOT NULL,
	"claim_relationship_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_hypothesis_support" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hypothesis_id" uuid NOT NULL,
	"work_id" uuid,
	"corpus_item_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "research_hypothesis_support_exactly_one_target" CHECK (("research_hypothesis_support"."work_id" IS NOT NULL AND "research_hypothesis_support"."corpus_item_id" IS NULL) OR ("research_hypothesis_support"."work_id" IS NULL AND "research_hypothesis_support"."corpus_item_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "research_revision" DROP CONSTRAINT "research_revision_typed_target";--> statement-breakpoint
ALTER TABLE "research_revision" ADD COLUMN "research_hypothesis_id" uuid;--> statement-breakpoint
ALTER TABLE "research_revision" ADD COLUMN "research_gap_id" uuid;--> statement-breakpoint
ALTER TABLE "research_gap" ADD CONSTRAINT "research_gap_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_gap" ADD CONSTRAINT "research_gap_project_id_research_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."research_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_gap" ADD CONSTRAINT "research_gap_debate_cluster_id_debate_cluster_id_fk" FOREIGN KEY ("debate_cluster_id") REFERENCES "public"."debate_cluster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_hypothesis" ADD CONSTRAINT "research_hypothesis_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_hypothesis" ADD CONSTRAINT "research_hypothesis_project_id_research_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."research_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_hypothesis_source" ADD CONSTRAINT "research_hypothesis_source_hypothesis_id_research_hypothesis_id_fk" FOREIGN KEY ("hypothesis_id") REFERENCES "public"."research_hypothesis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_hypothesis_source" ADD CONSTRAINT "research_hypothesis_source_claim_relationship_id_claim_relationship_id_fk" FOREIGN KEY ("claim_relationship_id") REFERENCES "public"."claim_relationship"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_hypothesis_support" ADD CONSTRAINT "research_hypothesis_support_hypothesis_id_research_hypothesis_id_fk" FOREIGN KEY ("hypothesis_id") REFERENCES "public"."research_hypothesis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_hypothesis_support" ADD CONSTRAINT "research_hypothesis_support_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_hypothesis_support" ADD CONSTRAINT "research_hypothesis_support_corpus_item_id_research_corpus_item_id_fk" FOREIGN KEY ("corpus_item_id") REFERENCES "public"."research_corpus_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_gap_project_idx" ON "research_gap" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "research_gap_user_status_idx" ON "research_gap" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "research_gap_user_cluster_unique" ON "research_gap" USING btree ("user_id","debate_cluster_id");--> statement-breakpoint
CREATE INDEX "research_hypothesis_project_idx" ON "research_hypothesis" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "research_hypothesis_user_status_idx" ON "research_hypothesis" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "research_hypothesis_user_run_hash_unique" ON "research_hypothesis" USING btree ("user_id","run_hash");--> statement-breakpoint
CREATE INDEX "research_hypothesis_source_hypothesis_idx" ON "research_hypothesis_source" USING btree ("hypothesis_id");--> statement-breakpoint
CREATE INDEX "research_hypothesis_source_relationship_idx" ON "research_hypothesis_source" USING btree ("claim_relationship_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_hypothesis_source_hypothesis_relationship_unique" ON "research_hypothesis_source" USING btree ("hypothesis_id","claim_relationship_id");--> statement-breakpoint
CREATE INDEX "research_hypothesis_support_hypothesis_idx" ON "research_hypothesis_support" USING btree ("hypothesis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_hypothesis_support_hypothesis_work_unique" ON "research_hypothesis_support" USING btree ("hypothesis_id","work_id") WHERE "research_hypothesis_support"."work_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "research_hypothesis_support_hypothesis_corpus_item_unique" ON "research_hypothesis_support" USING btree ("hypothesis_id","corpus_item_id") WHERE "research_hypothesis_support"."corpus_item_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_research_hypothesis_id_research_hypothesis_id_fk" FOREIGN KEY ("research_hypothesis_id") REFERENCES "public"."research_hypothesis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_research_gap_id_research_gap_id_fk" FOREIGN KEY ("research_gap_id") REFERENCES "public"."research_gap"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_revision_hypothesis_idx" ON "research_revision" USING btree ("research_hypothesis_id");--> statement-breakpoint
CREATE INDEX "research_revision_gap_idx" ON "research_revision" USING btree ("research_gap_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_revision_hypothesis_revision_unique" ON "research_revision" USING btree ("research_hypothesis_id","revision") WHERE "research_revision"."research_hypothesis_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "research_revision_gap_revision_unique" ON "research_revision" USING btree ("research_gap_id","revision") WHERE "research_revision"."research_gap_id" IS NOT NULL;--> statement-breakpoint
-- Reconciliation (D-25-7): the 0042 Evidence Chamber lane and this migration
-- each independently DROP+re-ADD "research_revision_typed_target" in
-- isolation, so each necessarily left the OTHER lane's new object types
-- inside a catch-all `object_type NOT IN (...)` branch it couldn't yet
-- enumerate. Landing after 0042, this migration's final CHECK covers all
-- seven typed object types explicitly (claim/relationship/cluster/chamber/
-- position/hypothesis/gap) with NO catch-all branch — the 27.2 merge-gate's
-- adversarial verification proved empirically that the catch-all let an
-- object_type='chamber' row with every typed FK NULL insert successfully,
-- silently falsifying the documented "unimplemented object types are
-- unsatisfiable" invariant. See packages/db/src/schema.ts's matching comment
-- for the full account.
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_typed_target" CHECK (("research_revision"."object_type" = 'claim' AND "research_revision"."research_claim_id" IS NOT NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL AND "research_revision"."evidence_chamber_id" IS NULL AND "research_revision"."evidence_chamber_position_id" IS NULL AND "research_revision"."research_hypothesis_id" IS NULL AND "research_revision"."research_gap_id" IS NULL)
        OR ("research_revision"."object_type" = 'relationship' AND "research_revision"."claim_relationship_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL AND "research_revision"."evidence_chamber_id" IS NULL AND "research_revision"."evidence_chamber_position_id" IS NULL AND "research_revision"."research_hypothesis_id" IS NULL AND "research_revision"."research_gap_id" IS NULL)
        OR ("research_revision"."object_type" = 'cluster' AND "research_revision"."debate_cluster_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."evidence_chamber_id" IS NULL AND "research_revision"."evidence_chamber_position_id" IS NULL AND "research_revision"."research_hypothesis_id" IS NULL AND "research_revision"."research_gap_id" IS NULL)
        OR ("research_revision"."object_type" = 'chamber' AND "research_revision"."evidence_chamber_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL AND "research_revision"."evidence_chamber_position_id" IS NULL AND "research_revision"."research_hypothesis_id" IS NULL AND "research_revision"."research_gap_id" IS NULL)
        OR ("research_revision"."object_type" = 'position' AND "research_revision"."evidence_chamber_position_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL AND "research_revision"."evidence_chamber_id" IS NULL AND "research_revision"."research_hypothesis_id" IS NULL AND "research_revision"."research_gap_id" IS NULL)
        OR ("research_revision"."object_type" = 'hypothesis' AND "research_revision"."research_hypothesis_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL AND "research_revision"."evidence_chamber_id" IS NULL AND "research_revision"."evidence_chamber_position_id" IS NULL AND "research_revision"."research_gap_id" IS NULL)
        OR ("research_revision"."object_type" = 'gap' AND "research_revision"."research_gap_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL AND "research_revision"."evidence_chamber_id" IS NULL AND "research_revision"."evidence_chamber_position_id" IS NULL AND "research_revision"."research_hypothesis_id" IS NULL));