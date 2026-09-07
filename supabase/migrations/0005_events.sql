-- Page-activity events (the analytics page's raw material): one append-only
-- row per thing a visitor did on the site that no other table records —
-- opening the served article page, leaving it (with the seconds it was
-- actually visible), opening the handout / self-quiz / word bank, tapping a
-- glossary word. AI-quiz and word-quiz completions are NOT duplicated here
-- (rc_quiz_sessions / rc_word_quiz_attempts stay the record); the analytics
-- page joins them in at read time. Raw events, not counters, so "how many
-- times" and "when" stay answerable without a schema change.
--
-- username is NULL for a logged-out visitor: kept, as a separate "anonymous"
-- bucket (owner's rule), never attributed. parent_id is stamped at write for
-- classroom scoping (the rc_quiz_sessions recipe). Same house rules as 0001:
-- rc_-prefixed (the Supabase project is shared with whisper-anywhere) and RLS
-- on with NO policies — service key only.

create table rc_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  username   text,                                   -- null = anonymous (logged out)
  parent_id  text,                                   -- stamped at write (classroom scoping)
  track      text not null check (track in ('senior','junior')),
  date       text check (date ~ '^\d{4}-\d{2}-\d{2}$'), -- the reading; null for pages with no reading (word bank)
  kind       text not null check (kind in (
               'article_view',   -- the served article page loaded            meta: {v}
               'article_read',   -- the reader left/hid it; cumulative visible seconds   meta: {v, seconds}
               'handout_view',
               'selfquiz_view',
               'wordbank_view',
               'gloss_tap'       -- a glossary word tapped on the article page  meta: {v, word, kind}
             )),
  meta       jsonb                                   -- small; `v` = per-page-load id tying a view to its reads/taps
);
create index rc_events_by_track_time on rc_events (track, at);
create index rc_events_by_user       on rc_events (username, at);

alter table rc_events enable row level security;
