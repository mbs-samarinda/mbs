-- History rows describe the past, so the database refuses to change them. The
-- trigger below blocks UPDATE, DELETE and TRUNCATE on every append-only table.
-- `apps/api/src/history-tables.integration.test.ts` lists those tables and fails
-- when one of them lacks it, so a new append-only table attaches it in the
-- migration that creates it.
--
-- The one way past it is correct_history(reason), run by hand as the database
-- owner, for a real correction, a legal erasure, or a migration that fills a
-- new column on old rows. It opens the gate for the current transaction only
-- and leaves an audit_logs row with the reason. Never drop or disable the
-- trigger instead.
CREATE FUNCTION forbid_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mbs.history_correction', true) = 'on' THEN
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
BEGIN
  IF reason IS NULL OR btrim(reason) = '' THEN
    RAISE EXCEPTION 'correct_history needs a reason';
  END IF;

  -- `true` makes the setting local: it ends with this transaction.
  PERFORM set_config('mbs.history_correction', 'on', true);

  INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    'DATABASE',
    session_user,
    'HISTORY_CORRECTION',
    'database',
    current_database(),
    jsonb_build_object('reason', reason)
  );
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
