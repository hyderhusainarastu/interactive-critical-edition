CREATE TABLE "research_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"cache_key" text NOT NULL,
	"results" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "research_cache_provider_key_unique" ON "research_cache" USING btree ("provider","cache_key");--> statement-breakpoint
CREATE INDEX "research_cache_expires_idx" ON "research_cache" USING btree ("expires_at");