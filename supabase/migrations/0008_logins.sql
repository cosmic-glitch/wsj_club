-- Login log: one append-only row per successful sign-in, with where it came
-- from. Written by /api/login (kind 'login') and /api/join (kind 'join', the
-- auto-login after a signup). Owner-only data: no UI reads it yet.
--
-- The location fields are Vercel's edge geolocation headers (approximate,
-- IP-based; null on a local `npm run dev`). parent_id is stamped at write for
-- classroom scoping, like rc_events. Same house rules as 0001: rc_-prefixed
-- (the Supabase project is shared with whisper-anywhere) and RLS on with NO
-- policies — service key only.

create table rc_logins (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  username    text not null references rc_users(username) on delete cascade,
  parent_id   text,                                   -- stamped at write (classroom scoping)
  kind        text not null check (kind in ('login', 'join')),
  ip          text,
  country     text,                                   -- ISO code, e.g. 'US'
  region      text,                                   -- ISO 3166-2 subdivision, e.g. 'CA'
  city        text,
  postal_code text,
  latitude    double precision,
  longitude   double precision,
  timezone    text,
  user_agent  text
);
create index rc_logins_by_user on rc_logins (username, at);

alter table rc_logins enable row level security;
