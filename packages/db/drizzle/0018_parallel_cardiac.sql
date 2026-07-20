ALTER TABLE "reading_record" ADD COLUMN "learning_resource_id" uuid;--> statement-breakpoint
ALTER TABLE "understanding_rating" ADD COLUMN "learning_resource_id" uuid;--> statement-breakpoint
ALTER TABLE "work" ADD COLUMN "work_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "reading_record" ADD CONSTRAINT "reading_record_learning_resource_id_learning_resource_id_fk" FOREIGN KEY ("learning_resource_id") REFERENCES "public"."learning_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "understanding_rating" ADD CONSTRAINT "understanding_rating_learning_resource_id_learning_resource_id_fk" FOREIGN KEY ("learning_resource_id") REFERENCES "public"."learning_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work" ADD CONSTRAINT "work_work_identity_id_work_identity_id_fk" FOREIGN KEY ("work_identity_id") REFERENCES "public"."work_identity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reading_record_learning_resource_idx" ON "reading_record" USING btree ("learning_resource_id");--> statement-breakpoint
CREATE INDEX "research_resource_normalized_key_idx" ON "research_resource" USING btree ("normalized_key");--> statement-breakpoint
CREATE INDEX "understanding_rating_learning_resource_idx" ON "understanding_rating" USING btree ("learning_resource_id");--> statement-breakpoint
CREATE INDEX "work_identity_idx" ON "work" USING btree ("work_identity_id");--> statement-breakpoint
ALTER TABLE "reading_record" ADD CONSTRAINT "reading_record_exactly_one_target" CHECK ((
      (case when "reading_record"."work_id" is null then 0 else 1 end) +
      (case when "reading_record"."bib_id" is null then 0 else 1 end) +
      (case when "reading_record"."learning_resource_id" is null then 0 else 1 end)
    ) = 1);--> statement-breakpoint
ALTER TABLE "understanding_rating" ADD CONSTRAINT "understanding_rating_exactly_one_target" CHECK ((
      (case when "understanding_rating"."work_id" is null then 0 else 1 end) +
      (case when "understanding_rating"."bib_id" is null then 0 else 1 end) +
      (case when "understanding_rating"."learning_resource_id" is null then 0 else 1 end)
    ) = 1);