CREATE TYPE "public"."document_type" AS ENUM('KARTU_KELUARGA', 'AKTA_KELAHIRAN', 'KARTU_IDENTITAS_ANAK', 'IJAZAH');--> statement-breakpoint
CREATE TABLE "document_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_cycle_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"required" boolean NOT NULL,
	CONSTRAINT "document_requirements_cycle_school_type_unique" UNIQUE("admission_cycle_id","school_id","document_type")
);
--> statement-breakpoint
ALTER TABLE "school_admission_settings" ADD COLUMN "accepted_instructions" text;--> statement-breakpoint
ALTER TABLE "school_admission_settings" ADD COLUMN "rejected_instructions" text;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_admission_cycle_id_admission_cycles_id_fk" FOREIGN KEY ("admission_cycle_id") REFERENCES "public"."admission_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;