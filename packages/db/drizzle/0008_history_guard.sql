-- Only correct_history writes a HISTORY_CORRECTION row: it runs as the NOLOGIN
-- role mbs_history_admin, and a second trigger refuses that action from any
-- other role. A superuser or the tables' owner can still disable triggers or
-- take that role, and today the API connects as the owning superuser `mbs`.
-- The guard is at full strength once the API connects as a role that owns
-- nothing and is not a member of mbs_history_admin.
DO $$
BEGIN
  CREATE ROLE mbs_history_admin NOLOGIN;
EXCEPTION
  -- Roles belong to the cluster, so a second database on it already has one.
  WHEN duplicate_object THEN NULL;
END;
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO mbs_history_admin;
--> statement-breakpoint
GRANT INSERT ON audit_logs TO mbs_history_admin;
--> statement-breakpoint
CREATE FUNCTION forbid_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  flag text := current_setting('mbs.history_correction', true);
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

  -- Postgres does not promise to evaluate AND from left to right (see
  -- "Expression Evaluation Rules" in its manual), so the cast to uuid waits
  -- for its own IF.
  IF flag ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    -- The stored 64-bit transaction id never wraps around. xmin is checked as
    -- well because only xmin differs inside a savepoint: there the correction
    -- is refused.
    IF EXISTS (
      SELECT 1 FROM audit_logs
      WHERE id = flag::uuid
        AND action = 'HISTORY_CORRECTION'
        AND metadata->>'xact' = pg_current_xact_id()::text
        AND xmin = pg_current_xact_id()::xid
    ) THEN
      -- A row-level BEFORE trigger that returns NULL silently skips the row,
      -- so the permitted change has to hand the row back.
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION '% on %: history rows are append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation',
      HINT = 'A real correction runs correct_history(reason) first, in the same transaction.';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION correct_history(reason text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Made here rather than returned by the insert: RETURNING would need SELECT
  -- on audit_logs, which this role does not have.
  correction uuid := gen_random_uuid();
BEGIN
  IF reason IS NULL OR btrim(reason) = '' THEN
    RAISE EXCEPTION 'correct_history needs a reason';
  END IF;

  INSERT INTO public.audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    correction,
    'DATABASE',
    session_user,
    'HISTORY_CORRECTION',
    'database',
    current_database(),
    jsonb_build_object('reason', reason, 'xact', pg_current_xact_id()::text)
  );

  -- `true` makes the setting local: it ends with this transaction.
  PERFORM set_config('mbs.history_correction', correction::text, true);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION correct_history(text) OWNER TO mbs_history_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION correct_history(text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION forbid_forged_correction() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Inside correct_history, a SECURITY DEFINER function, current_user is its owner.
  IF current_user <> 'mbs_history_admin' THEN
    RAISE EXCEPTION 'only correct_history() writes a HISTORY_CORRECTION row to audit_logs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_forbid_forged_correction BEFORE INSERT OR UPDATE ON audit_logs
  FOR EACH ROW WHEN (NEW.action = 'HISTORY_CORRECTION')
  EXECUTE FUNCTION forbid_forged_correction();
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
