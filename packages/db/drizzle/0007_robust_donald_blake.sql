CREATE INDEX "annotation_document_idx" ON "annotation" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "bookmark_document_idx" ON "bookmark" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "citation_document_idx" ON "citation" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_work_idx" ON "document" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "document_user_idx" ON "document" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "footnote_document_idx" ON "footnote" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "graph_edge_source_idx" ON "graph_edge" USING btree ("user_id","source_id");--> statement-breakpoint
CREATE INDEX "graph_edge_target_idx" ON "graph_edge" USING btree ("user_id","target_id");--> statement-breakpoint
CREATE INDEX "highlight_document_idx" ON "highlight" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "note_document_idx" ON "note" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "processing_job_document_idx" ON "processing_job" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "reading_record_user_idx" ON "reading_record" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "roadmap_override_root_idx" ON "roadmap_override" USING btree ("user_id","root_work_id");--> statement-breakpoint
CREATE INDEX "understanding_rating_user_idx" ON "understanding_rating" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "work_user_idx" ON "work" USING btree ("user_id");