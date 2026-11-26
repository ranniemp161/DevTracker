ALTER TYPE "public"."notification_type" ADD VALUE 'REQUEST_TRIAGED';--> statement-breakpoint
ALTER TABLE "task_requests" ADD COLUMN "decline_reason" text;