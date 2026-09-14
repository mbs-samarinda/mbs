-- Membership in an admission cycle is now implicit: every school is in every
-- cycle, and a school_admission_settings row is only an override. That flips
-- what a missing row means. It used to say "this school is not in this cycle";
-- from here it says "this school takes part at the cycle's defaults".
--
-- Without this backfill the flip would silently opt every previously-excluded
-- school into every past cycle. So each cycle that exists today gets an
-- explicit row for each school that has none, disabled — deliberate
-- non-participation written down instead of inferred from absence.
--
-- OPEN, CLOSED and ARCHIVED cycles only. DRAFT is deliberately left alone: a
-- draft was never visible to anyone, so a missing row there means "not
-- configured yet" rather than "deliberately excluded". Writing exclusion onto a
-- cycle the committee is still setting up would open it with every school
-- switched off, which is a worse default than the one this migration removes.
-- Idempotent: the (cycle, school) unique constraint makes a re-run a no-op.
INSERT INTO "school_admission_settings" ("admission_cycle_id", "school_id", "is_enabled")
SELECT "admission_cycles"."id", "schools"."id", false
FROM "admission_cycles"
CROSS JOIN "schools"
WHERE "admission_cycles"."status" <> 'DRAFT'
ON CONFLICT ("admission_cycle_id", "school_id") DO NOTHING;
