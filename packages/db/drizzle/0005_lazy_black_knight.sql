CREATE TYPE "public"."priority_tier" AS ENUM('essential', 'high', 'strongly_recommended', 'contextual', 'interpretive_aid', 'comparative', 'optional');--> statement-breakpoint
CREATE TYPE "public"."reading_status" AS ENUM('planned', 'reading', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "reading_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid,
	"bib_id" uuid,
	"status" "reading_status" DEFAULT 'planned' NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"root_work_id" uuid NOT NULL,
	"bib_id" uuid NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"manual_tier" "priority_tier",
	"manual_position" integer,
	"added_manually" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "understanding_rating" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid,
	"bib_id" uuid,
	"score" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reading_record" ADD CONSTRAINT "reading_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_record" ADD CONSTRAINT "reading_record_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_record" ADD CONSTRAINT "reading_record_bib_id_bibliographic_record_id_fk" FOREIGN KEY ("bib_id") REFERENCES "public"."bibliographic_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_override" ADD CONSTRAINT "roadmap_override_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_override" ADD CONSTRAINT "roadmap_override_root_work_id_work_id_fk" FOREIGN KEY ("root_work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_override" ADD CONSTRAINT "roadmap_override_bib_id_bibliographic_record_id_fk" FOREIGN KEY ("bib_id") REFERENCES "public"."bibliographic_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "understanding_rating" ADD CONSTRAINT "understanding_rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "understanding_rating" ADD CONSTRAINT "understanding_rating_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "understanding_rating" ADD CONSTRAINT "understanding_rating_bib_id_bibliographic_record_id_fk" FOREIGN KEY ("bib_id") REFERENCES "public"."bibliographic_record"("id") ON DELETE cascade ON UPDATE no action;