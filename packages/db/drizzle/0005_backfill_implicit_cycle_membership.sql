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
-- Cycles of every status, including DRAFT and ARCHIVED, so nothing is left
-- carrying the old meaning. Idempotent: the (cycle, school) unique constraint
-- makes a re-run a no-op.
INSERT INTO "school_admission_settings" ("admission_cycle_id", "school_id", "is_enabled")
SELECT "admission_cycles"."id", "schools"."id", false
FROM "admission_cycles"
CROSS JOIN "schools"
ON CONFLICT ("admission_cycle_id", "school_id") DO NOTHING;
