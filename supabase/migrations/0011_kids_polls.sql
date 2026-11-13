-- The elementary track (internal id "kids", lib/track.ts) gets the daily vote
-- too: widen rc_polls' track CHECK from ('senior','junior') to include 'kids'.
-- Same lookup as 0010 (the constraint was declared inline, so its name is
-- Postgres-generated): find it by definition, recreate it under the same name.
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid::regclass::text = 'rc_polls'
      and pg_get_constraintdef(c.oid) like '%track%junior%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I check (track in (''senior'', ''junior'', ''kids''))',
      r.tbl, r.conname
    );
  end loop;
end $$;
