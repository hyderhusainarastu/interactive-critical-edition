CREATE TABLE "work_identity_merge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"winner_identity_id" uuid NOT NULL,
	"loser_identity_id" uuid NOT NULL,
	"method" text NOT NULL,
	"evidence" jsonb,
	"reversal" jsonb NOT NULL,
	"created_by" "provenance_source" DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reverted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "learning_resource" ADD COLUMN "work_role" "record_role" DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_identity" ADD COLUMN "doi" text;--> statement-breakpoint
ALTER TABLE "work_identity" ADD COLUMN "isbn" text;--> statement-breakpoint
ALTER TABLE "work_identity" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "work_identity" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "work_identity_merge" ADD CONSTRAINT "work_identity_merge_winner_identity_id_work_identity_id_fk" FOREIGN KEY ("winner_identity_id") REFERENCES "public"."work_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_identity_merge" ADD CONSTRAINT "work_identity_merge_loser_identity_id_work_identity_id_fk" FOREIGN KEY ("loser_identity_id") REFERENCES "public"."work_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_identity_merge_winner_idx" ON "work_identity_merge" USING btree ("winner_identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_identity_merge_active_loser_unique" ON "work_identity_merge" USING btree ("loser_identity_id") WHERE reverted_at is null;--> statement-breakpoint
CREATE INDEX "work_identity_doi_idx" ON "work_identity" USING btree ("doi");--> statement-breakpoint
CREATE INDEX "work_identity_isbn_idx" ON "work_identity" USING btree ("isbn");--> statement-breakpoint
CREATE INDEX "work_identity_content_hash_idx" ON "work_identity" USING btree ("content_hash");