CREATE TABLE "chat_push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_push_preferences" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	CONSTRAINT "chat_push_preferences_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	CONSTRAINT "chat_push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "chat_push_deliveries" ADD CONSTRAINT "chat_push_deliveries_message_id_project_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."project_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_push_deliveries" ADD CONSTRAINT "chat_push_deliveries_subscription_id_chat_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."chat_push_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_push_preferences" ADD CONSTRAINT "chat_push_preferences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_push_preferences" ADD CONSTRAINT "chat_push_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_push_subscriptions" ADD CONSTRAINT "chat_push_subscriptions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_push_deliveries_due_idx" ON "chat_push_deliveries" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "chat_push_deliveries_subscription_idx" ON "chat_push_deliveries" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "chat_push_subscriptions_session_idx" ON "chat_push_subscriptions" USING btree ("session_id");