ALTER TABLE "projects" ADD COLUMN "internal_triage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_requests" ADD COLUMN "source" text DEFAULT 'form' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_requests" ADD COLUMN "reporter_user_id" uuid;--> statement-breakpoint
ALTER TABLE "task_requests" ADD CONSTRAINT "task_requests_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requests" ADD CONSTRAINT "task_requests_source_check" CHECK ("task_requests"."source" IN ('form', 'internal'));--> statement-breakpoint
ALTER TABLE "task_requests" ADD CONSTRAINT "task_requests_internal_no_contact" CHECK ("task_requests"."source" = 'form' OR ("task_requests"."reporter_name" IS NULL AND "task_requests"."reporter_email" IS NULL));