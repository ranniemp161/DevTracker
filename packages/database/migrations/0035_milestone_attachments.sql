CREATE TABLE "milestone_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"milestone_id" uuid NOT NULL,
	"uploader_id" uuid,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "milestone_attachments" ADD CONSTRAINT "milestone_attachments_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_attachments" ADD CONSTRAINT "milestone_attachments_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "milestone_attachments_milestone_id_idx" ON "milestone_attachments" USING btree ("milestone_id");