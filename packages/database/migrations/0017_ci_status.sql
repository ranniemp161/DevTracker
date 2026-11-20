CREATE TABLE "github_check_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"github_suite_id" bigint NOT NULL,
	"head_sha" text NOT NULL,
	"app_slug" text,
	"conclusion" text,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_check_suites_repo_suite_unique" UNIQUE("repository_id","github_suite_id")
);
--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD COLUMN "checks_state" text;--> statement-breakpoint
ALTER TABLE "github_check_suites" ADD CONSTRAINT "github_check_suites_repository_id_github_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_check_suites_repo_sha_idx" ON "github_check_suites" USING btree ("repository_id","head_sha");--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_checks_state_check" CHECK ("github_pull_requests"."checks_state" IN ('passing', 'failing'));