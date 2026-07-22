CREATE TYPE "public"."deletion_cleanup_status" AS ENUM('in_progress', 'storage_failed', 'completed');--> statement-breakpoint
CREATE TABLE "deletion_cleanup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"work_title" text NOT NULL,
	"status" "deletion_cleanup_status" DEFAULT 'in_progress' NOT NULL,
	"pending_storage_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"stage_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "deletion_cleanup" ADD CONSTRAINT "deletion_cleanup_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_cleanup_work_unique" ON "deletion_cleanup" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "deletion_cleanup_user_idx" ON "deletion_cleanup" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deletion_cleanup_status_idx" ON "deletion_cleanup" USING btree ("status");