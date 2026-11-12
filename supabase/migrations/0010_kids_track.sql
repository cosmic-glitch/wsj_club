-- The experimental kids track (lib/track.ts): widen every per-reading table's
-- track CHECK from ('senior','junior') to ('senior','junior','kids') so kids
-- quiz sessions, slots, events, reading marks and word-quiz rows can be
-- stored. rc_polls is left alone: the kids track has no vote.
--
-- The constraints were declared inline in 0001/0004/0005/0006, so their names
-- are Postgres-generated; this finds each one by table + definition instead of
-- guessing the name, and recreates it under the same name.
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid::regclass::text in (
        'rc_quiz_sessions', 'rc_quiz_slots', 'rc_events',
        'rc_reading_marks', 'rc_word_mastery', 'rc_word_quiz_attempts'
      )
      and pg_get_constraintdef(c.oid) like '%track%junior%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I check (track in (''senior'', ''junior'', ''kids''))',
      r.tbl, r.conname
    );
  end loop;
end $$;
