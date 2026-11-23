ALTER TYPE "public"."notification_type" ADD VALUE 'TASK_DONE_PROMPT';--> statement-breakpoint
CREATE TABLE "task_done_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution" text,
	CONSTRAINT "task_done_prompts_task_pr_unique" UNIQUE("task_id","pull_request_id"),
	CONSTRAINT "task_done_prompts_resolution_check" CHECK ("task_done_prompts"."resolution" IS NULL OR "task_done_prompts"."resolution" IN ('done', 'dismissed', 'status_done'))
);
--> statement-breakpoint
ALTER TABLE "task_done_prompts" ADD CONSTRAINT "task_done_prompts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_done_prompts" ADD CONSTRAINT "task_done_prompts_pull_request_id_github_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."github_pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_done_prompts" ADD CONSTRAINT "task_done_prompts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_done_prompts_open_idx" ON "task_done_prompts" USING btree ("task_id") WHERE "task_done_prompts"."resolved_at" IS NULL;