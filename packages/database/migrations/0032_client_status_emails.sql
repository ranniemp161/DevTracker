ALTER TABLE "task_requests" ADD COLUMN "email_token" text;--> statement-breakpoint
ALTER TABLE "task_requests" ADD COLUMN "emails_stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_requests" ADD COLUMN "accepted_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_requests" ADD COLUMN "declined_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_requests" ADD COLUMN "done_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_requests" ADD COLUMN "delivered_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_requests" ADD CONSTRAINT "task_requests_email_token_unique" UNIQUE("email_token");