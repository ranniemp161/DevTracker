ALTER TABLE "task_requests" DROP CONSTRAINT "task_requests_source_check";--> statement-breakpoint
ALTER TABLE "task_requests" DROP CONSTRAINT "task_requests_internal_no_contact";--> statement-breakpoint
ALTER TABLE "task_requests" ADD COLUMN "signoff_milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "task_requests" ADD CONSTRAINT "task_requests_signoff_milestone_id_milestones_id_fk" FOREIGN KEY ("signoff_milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requests" ADD CONSTRAINT "task_requests_source_check" CHECK ("task_requests"."source" IN ('form', 'internal', 'signoff'));--> statement-breakpoint
ALTER TABLE "task_requests" ADD CONSTRAINT "task_requests_internal_no_contact" CHECK ("task_requests"."source" <> 'internal' OR ("task_requests"."reporter_name" IS NULL AND "task_requests"."reporter_email" IS NULL));