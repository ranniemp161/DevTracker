ALTER TYPE "public"."notification_type" ADD VALUE 'MILESTONE_READY';--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "ready_notified_at" timestamp with time zone;