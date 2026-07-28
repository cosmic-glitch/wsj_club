-- Club article suggestions: any logged-in member can propose a URL for a
-- track ("Suggest" in the topline auth bar → app/api/suggestions). The
-- pick-article skills read the OPEN rows via scripts/suggestions.mjs and
-- weigh them alongside the candidates they scout themselves; the owner
-- resolves each one (used / declined) with the same script.
--
-- Same house rules as 0001: rc_-prefixed (the Supabase project is shared with
-- whisper-anywhere) and RLS on with NO policies — service key only.

create table rc_suggestions (
  id          uuid primary key default gen_random_uuid(),
  track       text not null check (track in ('senior','junior')),
  url         text not null,
  username    text not null,                 -- suggester; ALWAYS from the signed cookie
  status      text not null default 'open' check (status in ('open','used','declined')),
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Re-suggesting the same link is an upsert, not a pile-up (and re-opens a
  -- previously declined one — the member is asking again). Two people may
  -- still each suggest the same URL; the listing groups those.
  unique (track, url, username)
);
create index rc_suggestions_open on rc_suggestions (track, status, created_at);

alter table rc_suggestions enable row level security;
