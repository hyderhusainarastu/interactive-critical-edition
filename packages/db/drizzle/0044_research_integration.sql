CREATE TABLE "rag_message_claim_citation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rag_message" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "writer_citation" ADD COLUMN "research_claim_id" uuid;--> statement-breakpoint
ALTER TABLE "rag_message_claim_citation" ADD CONSTRAINT "rag_message_claim_citation_message_id_rag_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."rag_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_message_claim_citation" ADD CONSTRAINT "rag_message_claim_citation_claim_id_research_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."research_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rag_message_claim_citation_message_claim_unique" ON "rag_message_claim_citation" USING btree ("message_id","claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rag_message_claim_citation_message_ordinal_unique" ON "rag_message_claim_citation" USING btree ("message_id","ordinal");--> statement-breakpoint
CREATE INDEX "rag_message_claim_citation_claim_idx" ON "rag_message_claim_citation" USING btree ("claim_id");--> statement-breakpoint
ALTER TABLE "writer_citation" ADD CONSTRAINT "writer_citation_research_claim_id_research_claim_id_fk" FOREIGN KEY ("research_claim_id") REFERENCES "public"."research_claim"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "writer_citation_research_claim_idx" ON "writer_citation" USING btree ("research_claim_id");--> statement-breakpoint
ALTER TABLE "rag_message" ADD CONSTRAINT "rag_message_mode_valid" CHECK ("rag_message"."mode" IS NULL OR "rag_message"."mode" IN ('socratic', 'find_counterarguments', 'explain_disagreement', 'map_debate', 'find_support'));