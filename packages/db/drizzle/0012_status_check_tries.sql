CREATE TABLE "status_check_tries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "status_check_tries_subject" ON "status_check_tries" USING btree ("subject","created_at");--> statement-breakpoint
CREATE INDEX "status_check_tries_age" ON "status_check_tries" USING btree ("created_at");