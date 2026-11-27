CREATE TABLE "github_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"tag_name" text NOT NULL,
	"name" text,
	"url" text NOT NULL,
	"prerelease" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_releases_repository_tag_unique" UNIQUE("repository_id","tag_name")
);
--> statement-breakpoint
CREATE TABLE "milestone_github_releases" (
	"milestone_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"source" "task_link_source" NOT NULL,
	"linked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_github_releases_pk" PRIMARY KEY("milestone_id","release_id")
);
--> statement-breakpoint
ALTER TABLE "github_releases" ADD CONSTRAINT "github_releases_repository_id_github_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_github_releases" ADD CONSTRAINT "milestone_github_releases_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_github_releases" ADD CONSTRAINT "milestone_github_releases_release_id_github_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."github_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_github_releases" ADD CONSTRAINT "milestone_github_releases_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "milestone_github_releases_release_idx" ON "milestone_github_releases" USING btree ("release_id");