ALTER TABLE "document" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE INDEX "document_user_content_hash_idx" ON "document" USING btree ("user_id","content_hash");
