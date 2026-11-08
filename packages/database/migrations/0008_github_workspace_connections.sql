CREATE TABLE "github_workspace_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authorized_repository_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "github_workspace_connections_workspace_installation_unique" UNIQUE("workspace_id","installation_id")
);
--> statement-breakpoint
CREATE TABLE "github_workspace_repositories" (
	"connection_id" uuid NOT NULL,
	"github_repository_id" bigint NOT NULL,
	CONSTRAINT "github_workspace_repositories_pk" PRIMARY KEY("connection_id","github_repository_id")
);
--> statement-breakpoint
ALTER TABLE "github_installations" DROP CONSTRAINT "github_installations_workspace_id_workspaces_id_fk";
--> statement-breakpoint
DROP INDEX "github_installations_workspace_idx";--> statement-breakpoint
ALTER TABLE "github_install_states" ADD COLUMN "mode" text DEFAULT 'install' NOT NULL;--> statement-breakpoint
ALTER TABLE "github_install_states" ADD COLUMN "verified_installations" jsonb;--> statement-breakpoint
ALTER TABLE "github_workspace_connections" ADD CONSTRAINT "github_workspace_connections_installation_id_github_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_workspace_connections" ADD CONSTRAINT "github_workspace_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_workspace_connections" ADD CONSTRAINT "github_workspace_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_workspace_repositories" ADD CONSTRAINT "github_workspace_repositories_connection_id_github_workspace_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."github_workspace_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Preserve scoped API IDs and every existing project connection before removing ownership.
INSERT INTO "github_workspace_connections" ("id", "installation_id", "workspace_id", "connected_by", "connected_at", "authorized_repository_ids")
SELECT i."id", i."id", i."workspace_id", i."installed_by", i."installed_at",
  COALESCE((SELECT jsonb_agg(r."github_repository_id") FROM "github_repositories" r WHERE r."installation_id" = i."id"), '[]'::jsonb)
FROM "github_installations" i;
--> statement-breakpoint
INSERT INTO "github_workspace_repositories" ("connection_id", "github_repository_id")
SELECT i."id", r."github_repository_id"
FROM "github_installations" i JOIN "github_repositories" r ON r."installation_id" = i."id";
--> statement-breakpoint
ALTER TABLE "github_installations" DROP COLUMN "workspace_id";
