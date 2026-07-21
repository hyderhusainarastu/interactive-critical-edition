CREATE TABLE "writer_citation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"normalized_key" text NOT NULL,
	"csl_json" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "writer_document_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"content" jsonb NOT NULL,
	"reason" text DEFAULT 'autosave' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "writer_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "writer_project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "writer_citation" ADD CONSTRAINT "writer_citation_project_id_writer_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."writer_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writer_document_revision" ADD CONSTRAINT "writer_document_revision_document_id_writer_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."writer_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writer_document" ADD CONSTRAINT "writer_document_project_id_writer_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."writer_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writer_project" ADD CONSTRAINT "writer_project_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "writer_citation_project_idx" ON "writer_citation" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "writer_citation_project_key_unique" ON "writer_citation" USING btree ("project_id","normalized_key");--> statement-breakpoint
CREATE INDEX "writer_document_revision_document_idx" ON "writer_document_revision" USING btree ("document_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "writer_document_revision_unique" ON "writer_document_revision" USING btree ("document_id","revision");--> statement-breakpoint
CREATE INDEX "writer_document_project_archived_idx" ON "writer_document" USING btree ("project_id","archived_at","sort_order");--> statement-breakpoint
CREATE INDEX "writer_project_user_archived_idx" ON "writer_project" USING btree ("user_id","archived_at","sort_order");