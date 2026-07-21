CREATE TYPE "public"."graph_expansion_status" AS ENUM('planned', 'queued', 'running', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "graph_expansion_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_work_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"requested_candidates" integer NOT NULL,
	"estimated_cost_usd" real DEFAULT 0 NOT NULL,
	"hard_cap_usd" real DEFAULT 5 NOT NULL,
	"confirmed_at" timestamp,
	"idempotency_key" text NOT NULL,
	"status" "graph_expansion_status" DEFAULT 'planned' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "graph_expansion_request_count_valid" CHECK ("graph_expansion_request"."requested_candidates" > 0 AND "graph_expansion_request"."requested_candidates" <= 100),
	CONSTRAINT "graph_expansion_request_cap_valid" CHECK ("graph_expansion_request"."estimated_cost_usd" >= 0 AND "graph_expansion_request"."hard_cap_usd" > 0 AND "graph_expansion_request"."hard_cap_usd" <= 5)
);
--> statement-breakpoint
CREATE TABLE "work_relationship_judgment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_work_id" uuid NOT NULL,
	"target_work_id" uuid NOT NULL,
	"basis_hash" text NOT NULL,
	"relationship_type" "edge_type" NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"explanation" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"estimated_cost_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_relationship_judgment_distinct_works" CHECK ("work_relationship_judgment"."source_work_id" <> "work_relationship_judgment"."target_work_id"),
	CONSTRAINT "work_relationship_judgment_confidence_valid" CHECK ("work_relationship_judgment"."confidence" >= 0 AND "work_relationship_judgment"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "graph_expansion_request" ADD CONSTRAINT "graph_expansion_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_expansion_request" ADD CONSTRAINT "graph_expansion_request_source_work_id_work_id_fk" FOREIGN KEY ("source_work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_relationship_judgment" ADD CONSTRAINT "work_relationship_judgment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_relationship_judgment" ADD CONSTRAINT "work_relationship_judgment_source_work_id_work_id_fk" FOREIGN KEY ("source_work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_relationship_judgment" ADD CONSTRAINT "work_relationship_judgment_target_work_id_work_id_fk" FOREIGN KEY ("target_work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "graph_expansion_request_user_idx" ON "graph_expansion_request" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "graph_expansion_request_source_idx" ON "graph_expansion_request" USING btree ("source_work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_expansion_request_idempotency_unique" ON "graph_expansion_request" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "work_relationship_judgment_user_idx" ON "work_relationship_judgment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "work_relationship_judgment_source_idx" ON "work_relationship_judgment" USING btree ("source_work_id");--> statement-breakpoint
CREATE INDEX "work_relationship_judgment_target_idx" ON "work_relationship_judgment" USING btree ("target_work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_relationship_judgment_basis_unique" ON "work_relationship_judgment" USING btree ("user_id","source_work_id","target_work_id","basis_hash");