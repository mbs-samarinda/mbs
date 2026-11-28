CREATE TYPE "public"."payment_decision" AS ENUM('APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('BANK_TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('REGISTRATION', 'REREGISTRATION');--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "payment_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"decision" "payment_decision" NOT NULL,
	"reason" text,
	"reviewed_by_staff_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reviews_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "payment_reviews_reason_kept" CHECK ((reason is not null) = (decision = 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"amount_due" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"file_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_file_id_unique" UNIQUE("file_id")
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_reviewed_by_staff_id_staff_users_id_fk" FOREIGN KEY ("reviewed_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reviews" ADD CONSTRAINT "payment_reviews_event_id_application_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."application_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_application" ON "payments" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE TRIGGER files_forbid_change BEFORE UPDATE OR DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER files_forbid_truncate BEFORE TRUNCATE ON files
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER payments_forbid_change BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER payments_forbid_truncate BEFORE TRUNCATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER payment_reviews_forbid_change BEFORE UPDATE OR DELETE ON payment_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER payment_reviews_forbid_truncate BEFORE TRUNCATE ON payment_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();
