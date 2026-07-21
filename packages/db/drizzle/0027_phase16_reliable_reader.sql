ALTER TYPE "public"."text_block_kind" ADD VALUE 'endnote' BEFORE 'caption';--> statement-breakpoint
ALTER TABLE "text_block" ADD COLUMN "marker" text;