-- Decision record 0025 §6: milestone stages. Open milestones become Active, completed ones Delivered.
ALTER TABLE "milestones" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "milestones" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
UPDATE "milestones" SET "status" = CASE "status" WHEN 'COMPLETED' THEN 'DELIVERED' ELSE 'ACTIVE' END;--> statement-breakpoint
DROP TYPE "public"."milestone_status";--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('PLANNED', 'ACTIVE', 'CLIENT_REVIEW', 'DELIVERED');--> statement-breakpoint
ALTER TABLE "milestones" ALTER COLUMN "status" SET DATA TYPE "public"."milestone_status" USING "status"::"public"."milestone_status";--> statement-breakpoint
ALTER TABLE "milestones" ALTER COLUMN "status" SET DEFAULT 'PLANNED'::"public"."milestone_status";--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
-- Existing milestones keep a null started_at, so their tasks are never flagged as added after start.
UPDATE "milestones" SET "delivered_at" = "updated_at" WHERE "status" = 'DELIVERED';
