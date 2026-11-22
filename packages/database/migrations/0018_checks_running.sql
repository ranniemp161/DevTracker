ALTER TABLE "github_pull_requests" DROP CONSTRAINT "github_pull_requests_checks_state_check";--> statement-breakpoint
ALTER TABLE "github_check_suites" ALTER COLUMN "completed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "github_check_suites" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_checks_state_check" CHECK ("github_pull_requests"."checks_state" IN ('passing', 'running', 'failing'));