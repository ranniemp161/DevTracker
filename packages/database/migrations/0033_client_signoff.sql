ALTER TYPE "public"."notification_type" ADD VALUE 'MILESTONE_CLIENT_APPROVED';--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "signoff_token" text;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "client_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "client_approved_name" text;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "client_approved_note" text;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_signoff_token_unique" UNIQUE("signoff_token");