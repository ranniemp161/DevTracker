ALTER TYPE "public"."notification_type" ADD VALUE 'REQUEST_SUBMITTED';--> statement-breakpoint
CREATE TABLE "task_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"reporter_name" text,
	"reporter_email" text,
	"contact_deleted_at" timestamp with time zone,
	"triaged_by" uuid,
	"triaged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_requests_task_unique" UNIQUE("task_id"),
	CONSTRAINT "task_requests_kind_check" CHECK ("task_requests"."kind" IN ('bug', 'request')),
	CONSTRAINT "task_requests_status_check" CHECK ("task_requests"."status" IN ('new', 'accepted', 'declined'))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "intake_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "intake_token" text;--> statement-breakpoint
ALTER TABLE "task_requests" ADD CONSTRAINT "task_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requests" ADD CONSTRAINT "task_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requests" ADD CONSTRAINT "task_requests_triaged_by_users_id_fk" FOREIGN KEY ("triaged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_requests_project_status_idx" ON "task_requests" USING btree ("project_id","status","created_at");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_intake_token_unique" UNIQUE("intake_token");