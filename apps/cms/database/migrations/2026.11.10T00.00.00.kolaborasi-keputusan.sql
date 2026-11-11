-- Kolaborasi.status becomes Kolaborasi.keputusan. The Content Manager reads a
-- field named `status` as the publication status and refuses "diterima", so
-- no invite could be accepted from the edit view.
--
-- Strapi runs this before its schema sync. Renaming in place keeps every
-- answer; a sync on its own would drop the old column and add an empty one.
-- Field lists in admin permissions name the field too, and Strapi strips
-- names it no longer knows, which would leave editors unable to answer.
-- A fresh database has neither table yet, so both steps check first.
--
-- Strapi cannot run a .sql migration down. Reverting this change alone would
-- let the sync drop `keputusan` and add an empty `status`, so a revert must
-- ship a new migration that first runs the reverse: rename `keputusan` back to
-- `status`, and the same field-list update with the two names swapped.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'kolaborasi' and column_name = 'status'
  ) then
    alter table kolaborasi rename column status to keputusan;
  end if;

  if to_regclass('admin_permissions') is not null then
    update admin_permissions
    set properties = jsonb_set(
      properties,
      '{fields}',
      (
        select jsonb_agg(case when field = 'status' then 'keputusan' else field end)
        from jsonb_array_elements_text(properties -> 'fields') as field
      )
    )
    where subject = 'api::kolaborasi.kolaborasi' and properties -> 'fields' @> '["status"]';
  end if;
end
$$;
