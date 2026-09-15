-- Reading marks: a student's own attestation that they read a day's article
-- (level 1, "bronze") or read the handout too (level 2, "silver" — implies 1).
-- One row per (student, track, date), holding the HIGHEST level attested; a
-- mark only ever goes up (the route refuses a lower level). "Gold" (the AI
-- quiz) is NOT stored here — rc_quiz_sessions stays the record and the medal
-- is derived at read time (lib/medals.ts): gold if a completed session exists,
-- else silver/bronze from this row, else nothing.
--
-- parent_id is stamped at write for classroom scoping (the rc_quiz_sessions
-- recipe). Same house rules as 0001: rc_-prefixed (the Supabase project is
-- shared with whisper-anywhere) and RLS on with NO policies — service key only.

create table rc_reading_marks (
  username   text not null references rc_users(username),
  parent_id  text,                                    -- stamped at write (classroom scoping)
  track      text not null check (track in ('senior','junior')),
  date       text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),
  level      smallint not null check (level in (1, 2)), -- 1 = read the article, 2 = read the handout
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (username, track, date)
);
create index rc_reading_marks_by_scope on rc_reading_marks (parent_id);

alter table rc_reading_marks enable row level security;
