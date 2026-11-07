CREATE TABLE "project_chat_reads" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_sequence" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_chat_reads_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_message_mentions" (
	"message_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	CONSTRAINT "project_message_mentions_pk" PRIMARY KEY("message_id","mentioned_user_id")
);
--> statement-breakpoint
CREATE TABLE "project_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"sequence" integer NOT NULL,
	"client_request_id" text NOT NULL,
	"task_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "project_messages_project_seq_unique" UNIQUE("project_id","sequence"),
	CONSTRAINT "project_messages_project_author_client_req_unique" UNIQUE("project_id","author_id","client_request_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "next_message_sequence" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_chat_reads" ADD CONSTRAINT "project_chat_reads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chat_reads" ADD CONSTRAINT "project_chat_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_message_mentions" ADD CONSTRAINT "project_message_mentions_message_id_project_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."project_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_message_mentions" ADD CONSTRAINT "project_message_mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_chat_reads_user_project_idx" ON "project_chat_reads" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "project_message_mentions_user_idx" ON "project_message_mentions" USING btree ("mentioned_user_id");--> statement-breakpoint
CREATE INDEX "project_messages_project_seq_idx" ON "project_messages" USING btree ("project_id","sequence");--> statement-breakpoint
CREATE INDEX "project_messages_project_created_idx" ON "project_messages" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "project_messages_task_id_idx" ON "project_messages" USING btree ("task_id");