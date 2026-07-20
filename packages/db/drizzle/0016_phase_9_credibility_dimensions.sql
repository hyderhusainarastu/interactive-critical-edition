ALTER TABLE "credibility_assessment" ADD COLUMN "publication_rigor" real;--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "creator_expertise" real;--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "host_provenance" real;--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "pedagogical_value" real;--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "creator" jsonb;--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "peer_reviewed" boolean;--> statement-breakpoint
ALTER TABLE "credibility_assessment" ADD COLUMN "popularity" jsonb;