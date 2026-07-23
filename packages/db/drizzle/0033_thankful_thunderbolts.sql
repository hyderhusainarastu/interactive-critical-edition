CREATE TYPE "public"."competency_signal_status" AS ENUM('applied', 'undone', 'superseded', 'skipped_precedence');--> statement-breakpoint
CREATE TABLE "competency_signal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"concept_id" uuid,
	"work_id" uuid,
	"level" text NOT NULL,
	"new_score" integer NOT NULL,
	"previous_score" integer,
	"previous_source" "mastery_source",
	"basis" text NOT NULL,
	"detector" text NOT NULL,
	"status" "competency_signal_status" DEFAULT 'applied' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "competency_signal_exactly_one_target" CHECK ((
      (case when "competency_signal"."concept_id" is null then 0 else 1 end) +
      (case when "competency_signal"."work_id" is null then 0 else 1 end)
    ) = 1)
);
--> statement-breakpoint
ALTER TABLE "understanding_rating" ADD COLUMN "source" "mastery_source" DEFAULT 'explicit' NOT NULL;--> statement-breakpoint
ALTER TABLE "competency_signal" ADD CONSTRAINT "competency_signal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency_signal" ADD CONSTRAINT "competency_signal_conversation_id_rag_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."rag_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency_signal" ADD CONSTRAINT "competency_signal_message_id_rag_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."rag_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency_signal" ADD CONSTRAINT "competency_signal_concept_id_concept_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competency_signal" ADD CONSTRAINT "competency_signal_work_id_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competency_signal_user_idx" ON "competency_signal" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "competency_signal_conversation_idx" ON "competency_signal" USING btree ("conversation_id");