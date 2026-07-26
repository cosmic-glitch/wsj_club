-- Reading Club schema (PLAN-supabase.md). The Supabase project is SHARED
-- with whisper-anywhere: every Reading Club table is rc_-prefixed, and
-- migrations in this repo must only ever create/alter rc_* tables.
--
-- RLS is enabled with NO policies (deny-all): only the service key, which
-- bypasses RLS, can touch data. There is no browser-side Supabase access.

create table rc_users (
  username      text primary key,                -- login id, lowercased
  display_name  text not null,
  password_hash text not null,                   -- bcrypt, as in Blob today
  role          text not null check (role in ('parent','student')),
  parent_id     text references rc_users(username), -- students only
  active        boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now(),
  check ((role = 'student') = (parent_id is not null))
);

create table rc_quiz_sessions (                  -- TERMINAL attempts only
  id           uuid primary key default gen_random_uuid(),
  date         text not null,                    -- 'YYYY-MM-DD' (matches content keys)
  track        text not null default 'senior' check (track in ('senior','junior')),
  title        text not null,
  student_name text not null,
  login_user   text,
  parent_id    text,                             -- stamped at save (scoping)
  ended_at     timestamptz not null,
  duration_ms  integer,
  score        text,                             -- denormalized from report for the table
  report       jsonb,                            -- full report card (modal)
  transcript   jsonb not null default '[]',      -- Turn[] (modal)
  audio_url    text,                             -- stitched WAV in Blob
  partial      boolean not null default false,
  cancelled    boolean not null default false,
  failure      jsonb,
  resume_count integer not null default 0,
  diag         jsonb,
  source_blob  text unique,                      -- blob pathname: backfill/shadow idempotency key
  created_at   timestamptz not null default now()
);
create index rc_quiz_sessions_by_user  on rc_quiz_sessions (login_user, date);
create index rc_quiz_sessions_by_scope on rc_quiz_sessions (parent_id);

create table rc_quiz_slots (                     -- the pause/resume slot
  login_user   text not null,
  track        text not null check (track in ('senior','junior')),
  date         text not null,
  title        text not null,
  student_name text not null,
  parent_id    text,
  transcript   jsonb not null default '[]',
  tutor_done   boolean not null default false,
  resume_count integer not null default 0,
  failure      jsonb,
  audio_url    text,                             -- flushed slot WAV in Blob
  duration_ms  integer,
  diag         jsonb,                            -- carries the stable sessionId
  updated_at   timestamptz not null default now(),
  primary key (login_user, track, date)          -- at most one slot per (student, track, date)
);

create table rc_polls (
  id         uuid primary key default gen_random_uuid(),
  track      text not null check (track in ('senior','junior')),
  date       text not null,
  candidates jsonb not null,                     -- [{id,title,source,pitch,articleUrl,kind?}]
  created_at timestamptz not null default now(),
  unique (track, date)
);

create table rc_ballots (
  poll_id      uuid not null references rc_polls(id) on delete cascade,
  username     text not null,
  candidate_id text not null,
  updated_at   timestamptz not null default now(),
  primary key (poll_id, username)                -- one login = one vote; change = upsert
);

alter table rc_users         enable row level security;
alter table rc_quiz_sessions enable row level security;
alter table rc_quiz_slots    enable row level security;
alter table rc_polls         enable row level security;
alter table rc_ballots       enable row level security;
