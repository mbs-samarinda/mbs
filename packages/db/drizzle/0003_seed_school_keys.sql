-- The school list is a compile-time constant (SCHOOL_KEYS in
-- @mbs/school-config), not something an administrator creates, so the rows that
-- foreign keys point at belong in a migration rather than in a seed script an
-- environment might skip. Idempotent: re-running changes nothing.
INSERT INTO "schools" ("key") VALUES ('smp'), ('smk'), ('sma')
ON CONFLICT ("key") DO NOTHING;
