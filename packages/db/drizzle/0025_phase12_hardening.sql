CREATE TABLE "api_rate_limit" (
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"window_started_at" timestamp NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_rate_limit_user_id_scope_pk" PRIMARY KEY("user_id","scope"),
	CONSTRAINT "api_rate_limit_count_valid" CHECK ("api_rate_limit"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "api_rate_limit" ADD CONSTRAINT "api_rate_limit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_rate_limit_window_idx" ON "api_rate_limit" USING btree ("window_started_at");