CREATE TYPE "public"."actor_type" AS ENUM('FAMILY', 'STAFF', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."application_command" AS ENUM('SUBMIT', 'UPLOAD_PAYMENT_PROOF', 'APPROVE_PAYMENT', 'REJECT_PAYMENT', 'SUBMIT_DOCUMENTS', 'REQUEST_DOCUMENT_FIX', 'VERIFY_DOCUMENTS', 'ADVANCE_TO_INTERVIEW', 'STOP_AT_SCREENING', 'SCHEDULE_INTERVIEW', 'RESCHEDULE_INTERVIEW', 'RECORD_ATTENDED', 'RECORD_NO_SHOW', 'DECIDE', 'PUBLISH_ACCEPTED', 'PUBLISH_NOT_ACCEPTED', 'SUBMIT_REREGISTRATION', 'REQUEST_REREGISTRATION_FIX', 'CONFIRM_ENROLLMENT', 'WITHDRAW', 'ADD_NOTE', 'CHANGE_INTERVIEW_MODE');--> statement-breakpoint
CREATE TYPE "public"."application_stage" AS ENUM('PAYMENT_DUE', 'PAYMENT_REVIEW', 'DOCUMENTS_DUE', 'DOCUMENTS_REVIEW', 'SCREENING', 'INTERVIEW_PENDING', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'DECIDED', 'REREGISTRATION', 'REREGISTRATION_REVIEW', 'ENROLLED', 'NOT_ADVANCED', 'NOT_ACCEPTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."document_stage" AS ENUM('APPLICATION', 'REREGISTRATION');--> statement-breakpoint
CREATE TYPE "public"."interview_mode" AS ENUM('OFFLINE', 'ONLINE');--> statement-breakpoint
CREATE TABLE "applicant_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"author_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applicant_profile_versions_application_id_version_unique" UNIQUE("application_id","version")
);
--> statement-breakpoint
CREATE TABLE "application_access" (
	"application_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_access_application_id_user_id_pk" PRIMARY KEY("application_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "application_document_requirements" (
	"application_id" uuid NOT NULL,
	"stage" "document_stage" NOT NULL,
	"document_type" "document_type" NOT NULL,
	"required" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_document_requirements_application_id_stage_document_type_pk" PRIMARY KEY("application_id","stage","document_type")
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"command" "application_command" NOT NULL,
	"from_stage" "application_stage",
	"to_stage" "application_stage" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"family_visible" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_version" integer NOT NULL,
	"idempotency_key" text,
	"request_id" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_events_application_id_seq_unique" UNIQUE("application_id","seq")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_cycle_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"registration_seq" integer NOT NULL,
	"registration_number" text NOT NULL,
	"stage" "application_stage" NOT NULL,
	"interview_mode" "interview_mode",
	"nik" text NOT NULL,
	"registration_fee" integer NOT NULL,
	"last_event_seq" integer NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_cycle_school_seq_unique" UNIQUE("admission_cycle_id","school_id","registration_seq"),
	CONSTRAINT "applications_cycle_number_unique" UNIQUE("admission_cycle_id","registration_number"),
	CONSTRAINT "applications_cycle_school_nik_unique" UNIQUE("admission_cycle_id","school_id","nik"),
	CONSTRAINT "applications_nik_digits" CHECK (nik ~ '^[0-9]{16}$')
);
--> statement-breakpoint
ALTER TABLE "document_requirements" DROP CONSTRAINT "document_requirements_cycle_school_type_unique";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD COLUMN "stage" "document_stage" DEFAULT 'APPLICATION' NOT NULL;--> statement-breakpoint
ALTER TABLE "applicant_profile_versions" ADD CONSTRAINT "applicant_profile_versions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_profile_versions" ADD CONSTRAINT "applicant_profile_versions_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_access" ADD CONSTRAINT "application_access_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_access" ADD CONSTRAINT "application_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_document_requirements" ADD CONSTRAINT "application_document_requirements_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_admission_cycle_id_admission_cycles_id_fk" FOREIGN KEY ("admission_cycle_id") REFERENCES "public"."admission_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_events_actor_idempotency_key" ON "application_events" USING btree ("actor_type","actor_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_cycle_school_stage_type_unique" UNIQUE("admission_cycle_id","school_id","stage","document_type");