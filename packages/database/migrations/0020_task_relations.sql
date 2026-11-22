CREATE TYPE "public"."task_relation_type" AS ENUM('BLOCKS', 'RELATES');--> statement-breakpoint
CREATE TABLE "task_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"related_task_id" uuid NOT NULL,
	"type" "task_relation_type" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_relations_pair_unique" UNIQUE("task_id","related_task_id","type"),
	CONSTRAINT "task_relations_not_self" CHECK ("task_relations"."task_id" <> "task_relations"."related_task_id")
);
--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_related_task_id_tasks_id_fk" FOREIGN KEY ("related_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_relations_related_idx" ON "task_relations" USING btree ("related_task_id","type");