CREATE TYPE "public"."debate_cluster_status" AS ENUM('active', 'stale');--> statement-breakpoint
CREATE TABLE "debate_cluster_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debate_cluster_relationship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"claim_relationship_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debate_cluster" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"research_question" text,
	"description" text,
	"member_hash" text NOT NULL,
	"edge_count" integer DEFAULT 0 NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "debate_cluster_status" DEFAULT 'active' NOT NULL,
	"prompt_version" text,
	"provider" text,
	"model" text,
	"verification_status" "verification_status" DEFAULT 'unreviewed' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_revision" DROP CONSTRAINT "research_revision_typed_target";--> statement-breakpoint
ALTER TABLE "research_revision" ADD COLUMN "debate_cluster_id" uuid;--> statement-breakpoint
ALTER TABLE "debate_cluster_member" ADD CONSTRAINT "debate_cluster_member_cluster_id_debate_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."debate_cluster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_cluster_member" ADD CONSTRAINT "debate_cluster_member_claim_id_research_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."research_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_cluster_relationship" ADD CONSTRAINT "debate_cluster_relationship_cluster_id_debate_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."debate_cluster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_cluster_relationship" ADD CONSTRAINT "debate_cluster_relationship_claim_relationship_id_claim_relationship_id_fk" FOREIGN KEY ("claim_relationship_id") REFERENCES "public"."claim_relationship"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_cluster" ADD CONSTRAINT "debate_cluster_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_cluster" ADD CONSTRAINT "debate_cluster_project_id_research_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."research_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debate_cluster_member_cluster_idx" ON "debate_cluster_member" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "debate_cluster_member_claim_idx" ON "debate_cluster_member" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "debate_cluster_member_cluster_claim_unique" ON "debate_cluster_member" USING btree ("cluster_id","claim_id");--> statement-breakpoint
CREATE INDEX "debate_cluster_relationship_cluster_idx" ON "debate_cluster_relationship" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "debate_cluster_relationship_rel_idx" ON "debate_cluster_relationship" USING btree ("claim_relationship_id");--> statement-breakpoint
CREATE UNIQUE INDEX "debate_cluster_relationship_cluster_rel_unique" ON "debate_cluster_relationship" USING btree ("cluster_id","claim_relationship_id");--> statement-breakpoint
CREATE INDEX "debate_cluster_project_idx" ON "debate_cluster" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "debate_cluster_user_status_idx" ON "debate_cluster" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "debate_cluster_user_project_member_hash_unique" ON "debate_cluster" USING btree ("user_id","project_id","member_hash");--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_debate_cluster_id_debate_cluster_id_fk" FOREIGN KEY ("debate_cluster_id") REFERENCES "public"."debate_cluster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_revision_cluster_idx" ON "research_revision" USING btree ("debate_cluster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_revision_cluster_revision_unique" ON "research_revision" USING btree ("debate_cluster_id","revision") WHERE "research_revision"."debate_cluster_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "research_revision" ADD CONSTRAINT "research_revision_typed_target" CHECK (("research_revision"."object_type" = 'claim' AND "research_revision"."research_claim_id" IS NOT NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL)
        OR ("research_revision"."object_type" = 'relationship' AND "research_revision"."claim_relationship_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL)
        OR ("research_revision"."object_type" = 'cluster' AND "research_revision"."debate_cluster_id" IS NOT NULL AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL)
        OR ("research_revision"."object_type" NOT IN ('claim', 'relationship', 'cluster') AND "research_revision"."research_claim_id" IS NULL AND "research_revision"."claim_relationship_id" IS NULL AND "research_revision"."debate_cluster_id" IS NULL));