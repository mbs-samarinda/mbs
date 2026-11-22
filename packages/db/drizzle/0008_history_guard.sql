-- History rows describe the past, so the database refuses to change them. The
-- trigger below blocks UPDATE, DELETE and TRUNCATE on every append-only table.
-- `apps/api/src/history-tables.integration.test.ts` lists those tables and fails
-- when one of them lacks it, so a new append-only table attaches it in the
-- migration that creates it.
--
-- The one way past it is correct_history(reason), run by hand as the database
-- owner, for a real correction, a legal erasure, or a migration that fills a
-- new column on old rows. It writes a HISTORY_CORRECTION row to audit_logs and
-- points mbs.history_correction at it. The trigger trusts the flag only while
-- that row was written by the current transaction, so setting the flag by hand,
-- or reusing an old correction's id, opens nothing. Run it at the top level of
-- the transaction: inside a savepoint the row gets the savepoint's own
-- transaction id and the check refuses, which is the safe way to fail.
--
-- A correction's own row is never changed or removed, not even by a correction,
-- so audit_logs refuses TRUNCATE outright. Never drop or disable the trigger
-- instead.
CREATE FUNCTION forbid_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'audit_logs' THEN
    IF TG_OP = 'TRUNCATE' THEN
      RAISE EXCEPTION 'TRUNCATE on audit_logs: history rows are append-only, and correction rows are kept forever'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.action = 'HISTORY_CORRECTION' THEN
      RAISE EXCEPTION '% on audit_logs: a history correction''s own record is never changed', TG_OP
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  -- Compared as text: the setting may hold anything, and a cast would fail
  -- with a type error instead of the message below. xmin is a 32-bit xid, so
  -- the 64-bit pg_current_xact_id() is narrowed to match it.
  IF EXISTS (
    SELECT 1 FROM audit_logs
    WHERE id::text = current_setting('mbs.history_correction', true)
      AND action = 'HISTORY_CORRECTION'
      AND xmin = pg_current_xact_id()::xid
  ) THEN
    -- A row-level BEFORE trigger that returns NULL silently skips the row, so
    -- the permitted change has to hand the row back.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '% on %: history rows are append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation',
      HINT = 'A real correction runs correct_history(reason) first, in the same transaction.';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION correct_history(reason text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  correction uuid;
BEGIN
  IF reason IS NULL OR btrim(reason) = '' THEN
    RAISE EXCEPTION 'correct_history needs a reason';
  END IF;

  INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    'DATABASE',
    session_user,
    'HISTORY_CORRECTION',
    'database',
    current_database(),
    jsonb_build_object('reason', reason)
  )
  RETURNING id INTO correction;

  -- `true` makes the setting local: it ends with this transaction.
  PERFORM set_config('mbs.history_correction', correction::text, true);
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION correct_history(text) FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER audit_logs_forbid_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER audit_logs_forbid_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER application_events_forbid_change BEFORE UPDATE OR DELETE ON application_events
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER application_events_forbid_truncate BEFORE TRUNCATE ON application_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER applicant_profile_versions_forbid_change BEFORE UPDATE OR DELETE ON applicant_profile_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER applicant_profile_versions_forbid_truncate BEFORE TRUNCATE ON applicant_profile_versions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER application_document_requirements_forbid_change BEFORE UPDATE OR DELETE ON application_document_requirements
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER application_document_requirements_forbid_truncate BEFORE TRUNCATE ON application_document_requirements
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();
