CREATE TYPE "public"."task_link_source" AS ENUM('MANUAL', 'AUTO');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED');--> statement-breakpoint
CREATE TABLE "github_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"sha" text NOT NULL,
	"message" text NOT NULL,
	"author_login" text,
	"author_name" text,
	"url" text NOT NULL,
	"branch" text NOT NULL,
	"committed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_commits_repo_sha_unique" UNIQUE("repository_id","sha")
);
--> statement-breakpoint
CREATE TABLE "github_pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"github_pr_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"author_login" text,
	"head_branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"state" text NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"merged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"opened_at" timestamp (3) with time zone NOT NULL,
	"github_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_pull_requests_repo_pr_unique" UNIQUE("repository_id","github_pr_id")
);
--> statement-breakpoint
CREATE TABLE "github_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"github_review_id" bigint NOT NULL,
	"reviewer_login" text,
	"state" text NOT NULL,
	"url" text,
	"submitted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "github_reviews_pr_review_unique" UNIQUE("pull_request_id","github_review_id")
);
--> statement-breakpoint
CREATE TABLE "github_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"action" text,
	"github_installation_id" bigint,
	"github_repository_id" bigint,
	"payload" jsonb,
	"processing_status" "webhook_delivery_status" DEFAULT 'RECEIVED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"error_message" text,
	CONSTRAINT "github_webhook_deliveries_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
CREATE TABLE "task_github_links" (
	"task_id" uuid NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"source" "task_link_source" NOT NULL,
	"linked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_github_links_pk" PRIMARY KEY("task_id","pull_request_id")
);
--> statement-breakpoint
ALTER TABLE "github_commits" ADD CONSTRAINT "github_commits_repository_id_github_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_repository_id_github_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_reviews" ADD CONSTRAINT "github_reviews_pull_request_id_github_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."github_pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_github_links" ADD CONSTRAINT "task_github_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_github_links" ADD CONSTRAINT "task_github_links_pull_request_id_github_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."github_pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_github_links" ADD CONSTRAINT "task_github_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_pull_requests_repo_opened_idx" ON "github_pull_requests" USING btree ("repository_id","opened_at","id");--> statement-breakpoint
CREATE INDEX "github_webhook_deliveries_retry_idx" ON "github_webhook_deliveries" USING btree ("processing_status","received_at") WHERE "github_webhook_deliveries"."processing_status" IN ('RECEIVED', 'PROCESSING', 'FAILED');--> statement-breakpoint
CREATE INDEX "task_github_links_pull_request_idx" ON "task_github_links" USING btree ("pull_request_id");