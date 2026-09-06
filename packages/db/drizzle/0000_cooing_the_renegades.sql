CREATE TYPE "public"."cycle_status" AS ENUM('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "admission_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"registration_open_at" timestamp with time zone NOT NULL,
	"registration_close_at" timestamp with time zone NOT NULL,
	"result_publish_at" timestamp with time zone NOT NULL,
	"default_fee" integer NOT NULL,
	"status" "cycle_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_admission_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_cycle_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"fee_override" integer,
	"is_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "school_admission_settings_admission_cycle_id_school_id_unique" UNIQUE("admission_cycle_id","school_id")
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"level" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schools_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "school_admission_settings" ADD CONSTRAINT "school_admission_settings_admission_cycle_id_admission_cycles_id_fk" FOREIGN KEY ("admission_cycle_id") REFERENCES "public"."admission_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_admission_settings" ADD CONSTRAINT "school_admission_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;