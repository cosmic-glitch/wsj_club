-- Word-bank quiz: each student can quiz themselves on their personal word
-- bank (the vocab from readings they've voice-quizzed on). Two tables:
--
--   rc_word_mastery      — one row per (student, track, word): the Leitner
--                          box + counters that schedule when a word is next
--                          due for review. Written only by /api/word-quiz.
--   rc_word_quiz_attempts — one row per completed round: the full question
--                          list with the student's picks, plus the score.
--                          parent_id is stamped at save for classroom scoping
--                          (same recipe as rc_quiz_sessions).
--
-- Same house rules as 0001: rc_-prefixed (the Supabase project is shared with
-- whisper-anywhere) and RLS on with NO policies — service key only.

create table rc_word_mastery (
  username      text not null references rc_users(username),
  track         text not null check (track in ('senior','junior')),
  word          text not null,                   -- exactly as authored in the content JSON
  date          text not null,                   -- source reading 'YYYY-MM-DD' (latest, if a word recurs)
  box           integer not null default 0 check (box between 0 and 5), -- Leitner: 0 = new/lapsed, 5 = fully spaced out
  times_right   integer not null default 0,
  times_wrong   integer not null default 0,
  last_result   boolean,
  last_asked_at timestamptz,
  next_due      date,                            -- due when next_due <= today (club-local day)
  updated_at    timestamptz not null default now(),
  primary key (username, track, word)
);

create table rc_word_quiz_attempts (
  id         uuid primary key default gen_random_uuid(),
  username   text not null,
  parent_id  text,                               -- stamped at save (classroom scoping)
  track      text not null check (track in ('senior','junior')),
  questions  jsonb not null,                     -- [{word,date,kind,prompt,options,answerIndex,pickedIndex,correct}]
  score      integer not null,
  total      integer not null,
  created_at timestamptz not null default now()
);
create index rc_word_quiz_attempts_by_user  on rc_word_quiz_attempts (username, created_at);
create index rc_word_quiz_attempts_by_scope on rc_word_quiz_attempts (parent_id);

alter table rc_word_mastery       enable row level security;
alter table rc_word_quiz_attempts enable row level security;
