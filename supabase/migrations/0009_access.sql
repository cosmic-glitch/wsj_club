-- Access log: where each logged-in member uses the site from, rolled up to
-- one row per (member, Pacific day, IP) with first/last access and a request
-- count. Touched from /api/me (the login bar, once per page load on every
-- page) and /api/events (the served article pages' beacon), after the
-- response, via rc_touch_access (lib/access.ts). Logged-out traffic is not
-- recorded. Sign-ins themselves are in rc_logins (0008). Write-only for now.
--
-- Location fields are Vercel's edge geolocation headers (approximate,
-- IP-based), refreshed on every touch. Same house rules as 0001: rc_-prefixed
-- (the Supabase project is shared with whisper-anywhere) and RLS on with NO
-- policies — service key only.

create table rc_access (
  username    text not null references rc_users(username) on delete cascade,
  day         date not null,                          -- America/Los_Angeles calendar day
  ip          text not null default '',               -- '' when the request carried none
  parent_id   text,                                   -- stamped at write (classroom scoping)
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  hits        integer not null default 1,             -- requests, not page views
  country     text,
  region      text,
  city        text,
  postal_code text,
  latitude    double precision,
  longitude   double precision,
  timezone    text,
  user_agent  text,                                   -- the most recent one
  primary key (username, day, ip)
);
create index rc_access_by_last on rc_access (last_at);

alter table rc_access enable row level security;

-- Atomic upsert + increment (PostgREST's plain upsert can't add to a column).
create function rc_touch_access(p jsonb) returns void
language sql
set search_path = public
as $$
  insert into rc_access as a (
    username, day, ip, parent_id, country, region, city, postal_code,
    latitude, longitude, timezone, user_agent
  ) values (
    p->>'username',
    (now() at time zone 'America/Los_Angeles')::date,
    coalesce(p->>'ip', ''),
    p->>'parent_id',
    p->>'country', p->>'region', p->>'city', p->>'postal_code',
    (p->>'latitude')::double precision, (p->>'longitude')::double precision,
    p->>'timezone', p->>'user_agent'
  )
  on conflict (username, day, ip) do update set
    last_at     = now(),
    hits        = a.hits + 1,
    parent_id   = excluded.parent_id,
    country     = coalesce(excluded.country, a.country),
    region      = coalesce(excluded.region, a.region),
    city        = coalesce(excluded.city, a.city),
    postal_code = coalesce(excluded.postal_code, a.postal_code),
    latitude    = coalesce(excluded.latitude, a.latitude),
    longitude   = coalesce(excluded.longitude, a.longitude),
    timezone    = coalesce(excluded.timezone, a.timezone),
    user_agent  = coalesce(excluded.user_agent, a.user_agent);
$$;

-- Service key only, like the tables.
revoke execute on function rc_touch_access(jsonb) from public, anon, authenticated;
grant execute on function rc_touch_access(jsonb) to service_role;
