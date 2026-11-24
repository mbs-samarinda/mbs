CREATE TABLE "school_agreement_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_agreement_versions_school_id_version_unique" UNIQUE("school_id","version")
);
--> statement-breakpoint
ALTER TABLE "admission_cycles" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "admission_cycles" ADD COLUMN "bank_account_number" text;--> statement-breakpoint
ALTER TABLE "admission_cycles" ADD COLUMN "bank_account_holder" text;--> statement-breakpoint
ALTER TABLE "school_admission_settings" ADD COLUMN "reregistration_fee" integer;--> statement-breakpoint
ALTER TABLE "school_agreement_versions" ADD CONSTRAINT "school_agreement_versions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_agreement_versions" ADD CONSTRAINT "school_agreement_versions_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER school_agreement_versions_forbid_change BEFORE UPDATE OR DELETE ON school_agreement_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER school_agreement_versions_forbid_truncate BEFORE TRUNCATE ON school_agreement_versions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();
