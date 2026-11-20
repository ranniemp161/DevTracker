ALTER TABLE "project_messages" ADD COLUMN "kind" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_messages" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "chat_github_events" text[] DEFAULT ARRAY['pull_request.opened','pull_request.merged','review.changes_requested','release.published','checks.failed']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_kind_check" CHECK ("project_messages"."kind" IN ('user', 'github'));