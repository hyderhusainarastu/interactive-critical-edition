ALTER TABLE "work" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
CREATE INDEX "work_deleted_at_idx" ON "work" USING btree ("deleted_at");