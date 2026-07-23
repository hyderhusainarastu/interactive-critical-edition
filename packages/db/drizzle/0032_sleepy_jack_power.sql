ALTER TABLE "passage_annotation" ADD COLUMN "verification_status" "verification_status" DEFAULT 'unreviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE "passage_annotation" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "passage_annotation" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;