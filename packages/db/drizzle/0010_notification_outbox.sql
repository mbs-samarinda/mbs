CREATE TYPE "public"."notification_attempt_outcome" AS ENUM('SENT', 'FAILED', 'LEASE_EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('EMAIL');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENDING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TABLE "notification_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" "notification_attempt_outcome" NOT NULL,
	"response_code" text,
	"error_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_attempts_notification_id_attempt_unique" UNIQUE("notification_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid,
	"event_id" uuid,
	"user_id" text,
	"channel" "notification_channel" NOT NULL,
	"template_key" text NOT NULL,
	"template_version" integer NOT NULL,
	"recipient" text NOT NULL,
	"subject" text,
	"body_text" text,
	"body_html" text,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_content_kept" CHECK (case when template_key = 'sign-in-code'
        then subject is null and body_text is null and body_html is null
        else subject is not null and body_text is not null end)
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_application_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."application_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_event_user" ON "notifications" USING btree ("event_id","user_id") WHERE event_id is not null;--> statement-breakpoint
CREATE INDEX "notifications_due" ON "notifications" USING btree ("next_attempt_at") WHERE status in ('PENDING', 'SENDING');--> statement-breakpoint
CREATE TRIGGER notification_attempts_forbid_change BEFORE UPDATE OR DELETE ON notification_attempts
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER notification_attempts_forbid_truncate BEFORE TRUNCATE ON notification_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();