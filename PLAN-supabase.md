# PLAN: Migrate structured data from Vercel Blob to Supabase (Postgres)

_Reviewed against main through `fd11016` (2026-07-25): the commits since the
plan first landed are content/authoring-side (the 07-25 reading; article pages
now captured for open sources too; no-byline titles) and don't touch the data
layer — nothing here changes because of them._

## Why

The app uses Vercel Blob as a database, and the seams are widening as it grows
(~10 students now, ambition to scale if the idea spreads):

- **The Scores page makes ~120 blob fetches per view** (one per saved session)
  because Blob's only read unit is the whole object — the score table needs 15
  small fields but must download every attempt's full transcript+diag to get
  them. Measured: ~30s worst-case from a laptop; multi-second in prod; grows by
  one fetch per quiz forever.
- **No read-after-write consistency** → the `?v=` cache-buster machinery in
  `lib/users.ts`, `lib/sessions.ts`, `lib/session-io.ts` (`readSlot`), the vote
  route, and the backup script, plus the measured `list()`-lag caveats.
- **No transactions / atomic upserts** → the checkpoint-drain dance in
  `VoiceQuiz.finalizeQuiz`, the vote route's one-blob-per-ballot design, the
  lost-update risk that killed the "index blob" idea.
- **No queries** → every scoping/filtering/tallying operation is
  list-everything-and-filter in JS.

Supabase (Postgres) fixes all four structurally. The owner already runs
Supabase on `../foliotracker`, so the patterns (server-side `@supabase/supabase-js`
with the service key, `supabase/migrations`, `SUPABASE_DB_URL` + `pg` for
scripts, VM cron env plumbing) carry over directly. Even optimistic growth
(1,000 students × 1 quiz/day) is trivial for Postgres.

## What moves, what stays

**Moves to Postgres** (small, structured, mutable, queried):

| Today (Blob)                                      | Becomes            |
| ------------------------------------------------- | ------------------ |
| `users/<username>.json`                           | `users` table      |
| `quiz-sessions/[junior/]<date>/<name>-<rand>.json` (terminal sessions) | `quiz_sessions` table |
| `quiz-sessions/[junior/]<date>/<name>-inprogress.json` (pause/resume slot) | `quiz_slots` table |
| `votes/[junior/]<date>/poll.json`                 | `polls` table      |
| `votes/[junior/]<date>/ballots/<name>.json`       | `ballots` table    |

**Stays in Blob / static** (large, immutable, served-by-URL — the right tool):

- Teacher recordings (`…/<name>-<rand>.wav`) and the slot's flushed
  `…-inprogress.wav` — the whole `/api/quiz-audio` client-upload token flow is
  untouched; DB rows store the blob URL.
- Transient per-answer clips (`quiz-sessions/…/turns/…`) — untouched.
- Article text (`article-text/…`) — untouched (`lib/article-text.ts` as-is).
- Article pages, glossaries, pronunciation clips (committed to the repo) — untouched.

**Legacy naming dies at the boundary move.** The Blob store kept
`role: "teacher"` / `teacherId` for byte-compatibility. The DB is a new store,
so it uses the modern names (`parent`, `parent_id`) natively —
`fromStored`/`toStored` in `lib/users.ts` and the `teacherId` normalization in
`lib/sessions.ts` are deleted, not ported. (The `/api/students` POST keeps
accepting the `teacherId` body alias for stale clients; it just maps to
`parent_id` at the route.)

## Setup (Phase 0)

1. **New free Supabase project** `wsj-club` (separate from foliotracker —
   isolation, independent backups). Free-tier pause-on-idle is defused by the
   daily backup cron (below); daily quiz traffic makes it moot anyway.
2. **Env vars** (Vercel Production + Preview, and `.env.local`):
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (app routes), `SUPABASE_DB_URL`
   (scripts/migrations only — the foliotracker `pg` recipe). Never expose an
   anon key; there is no browser-side Supabase access.
3. **Deps**: `@supabase/supabase-js` (app), `pg` (devDependency, scripts).
4. **`lib/db.ts`**: one lazily-created server-side supabase-js client
   (`createClient(url, serviceKey, { auth: { persistSession: false } })`).
   PostgREST-over-HTTP means no connection pooling to manage in serverless.
5. **Migrations**: `supabase/migrations/0001_init.sql`, applied with `psql
   "$SUPABASE_DB_URL" -f …` (matching foliotracker's convention). RLS is
   ENABLED on every table with **no policies** — deny-all for anon/authed
   roles; only the service key (which bypasses RLS) can touch data.

## Schema

```sql
create table users (
  username      text primary key,                -- login id, lowercased
  display_name  text not null,
  password_hash text not null,                   -- bcrypt, as today
  role          text not null check (role in ('parent','student')),
  parent_id     text references users(username), -- students only
  active        boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now(),
  check ((role = 'student') = (parent_id is not null))
);

create table quiz_sessions (                     -- TERMINAL attempts only
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
  source_blob  text unique,                      -- backfill provenance + idempotency; null on new rows
  created_at   timestamptz not null default now()
);
create index quiz_sessions_by_user  on quiz_sessions (login_user, date);
create index quiz_sessions_by_scope on quiz_sessions (parent_id);

create table quiz_slots (                        -- the pause/resume slot
  login_user  text not null,
  track       text not null check (track in ('senior','junior')),
  date        text not null,
  title       text not null,
  student_name text not null,
  parent_id   text,
  transcript  jsonb not null default '[]',
  tutor_done  boolean not null default false,
  resume_count integer not null default 0,
  failure     jsonb,
  audio_url   text,                              -- flushed slot WAV in Blob
  duration_ms integer,
  diag        jsonb,                             -- carries the stable sessionId
  updated_at  timestamptz not null default now(),
  primary key (login_user, track, date)          -- "at most one slot per (student, track, date)" — now a DB invariant
);

create table polls (
  id         uuid primary key default gen_random_uuid(),
  track      text not null check (track in ('senior','junior')),
  date       text not null,
  candidates jsonb not null,                     -- [{id,title,source,pitch,articleUrl,kind?}]
  created_at timestamptz not null default now(),
  unique (track, date)
);

create table ballots (
  poll_id      uuid not null references polls(id) on delete cascade,
  username     text not null,
  candidate_id text not null,
  updated_at   timestamptz not null default now(),
  primary key (poll_id, username)                -- one login = one vote; change = upsert
);
```

Notes:
- `date` stays `text` (the app's universal key format; no TZ ambiguity).
- `score` is denormalized so the Scores table never touches `report`; the
  save path writes both (single insert — no drift possible).
- The slot PK replaces today's "stable overwritable pathname" convention; the
  cookie-derived-identity rule stays (routes key by the cookie user, never the
  body).
- `sanitize*` in `lib/session-io.ts` all stay — client input is untrusted
  regardless of where it lands.

## Code changes, module by module

**`lib/db.ts`** (new): the shared service-key client.

**`lib/users.ts`**: same exported API (`getUser`, `verifyLogin`,
`listStudents`, `listParents`, `createUser`, `setPassword`, `rename`,
`setActive`, `upsertUser`), internals become single queries. DELETE:
`fromStored`/`toStored`, `loadAll`, the 15s cache + `invalidateUserCache`, the
`?v=` buster. Uniqueness check on create becomes the PK (catch `23505` →
`username-taken`). Callers (auth, routes, admin pages) don't change.

**`lib/auth.ts`**: unchanged (cookie/HMAC + lookups via lib/users). The
`AUTH_USERS`/`ADMIN_USERS` env fallback survives until Phase 4 cleanup.

**`lib/sessions.ts`**: `loadSessions()` becomes one select of the slim columns
(no transcript/report/diag) over `quiz_sessions` UNION the `quiz_slots` rows
mapped to `inProgress: true` shape — preserving today's contract where the
Scores page sees slots as sessions. `Session.blobUrl` → `Session.id` (slot ids
are the composite key, serialized `slot:<login>:<track>:<date>`). Track emitted
as today (`"junior"` or absent).

**`lib/session-io.ts`**: sanitizers stay; `sessionPrefix`/`slotAudioPathname`
stay (audio paths are still Blob); `slotJsonPathname` + `readSlot` +
`deleteSlot` become `getSlot`/`upsertSlot`/`deleteSlot` DB helpers (`track`
stays a REQUIRED param — same rationale, now also enforced by the PK). All
CDN-staleness comments/workarounds die.

**`app/api/quiz-progress`**: POST → `upsertSlot` (one atomic upsert — the
overwrite-in-place semantics are now transactional); GET → `getSlot` (no
cache-buster; reads are consistent, killing the "resume within ~2s can miss the
last turn" gap); DELETE (start-over) → insert a `cancelled` row into
`quiz_sessions` (archiving the slot, audio blob copied to a permanent key as
today) + delete the slot row, in one transaction via a small
`archive_slot` SQL function (or sequential with the insert first — same order
as today's copy-then-delete).

**`app/api/quiz-report`**: terminal save inserts into `quiz_sessions` then
deletes the slot row (insert-then-delete preserves today's "a storage hiccup
keeps Continue alive" ordering). Slot-WAV salvage (copy blob to permanent key)
unchanged. Grading unchanged.

**`app/api/quiz-session`**: DELETE takes `{id}` instead of blob URLs — fetch
row, scope-check (owner exempt, as today), `del()` the audio blob if any,
delete the row. Slot rows delete via their serialized id. NEW: **GET `?id=`**
returning `{transcript, report}` for the Details modal — auth-scoped
server-side (owner: any; parent: own classroom; student: own, non-cancelled).
This upgrades yesterday's modal change: details stop being
public-URL-unguessable and become properly auth-gated.

**`components/AdminSessions.tsx`**: row key + Delete + details-fetch switch
from `blobUrl` to `id`; `openDetails` calls `/api/quiz-session?id=` (keyed
race-guard logic unchanged). **`components/DeleteSessionButton.tsx`**: takes
`id`.

**`app/admin/page.tsx` / `students/page.tsx`**: unchanged in shape —
`loadSessions`/`listStudents`/`listParents` keep their contracts. (Optional
later: push scoping into SQL; not needed for correctness.)

**`app/api/quiz-dates`**: `select distinct date from quiz_sessions where …` —
or keep filtering `loadSessions()` output; either is fine, the data is small.

**`app/api/vote`**: GET → newest poll for the track (one query), active iff no
reading exists for its date (unchanged derivation, still checked against
`content/`); caller's ballot + tally via two more cheap queries (`count(*)
group by candidate_id`). POST → upsert into `ballots`. All vote-blob
cache-busting dies.

**Scripts**:
- `scripts/open-vote.mjs` / `check-vote.mjs`: swap blob I/O for supabase-js
  with the service key (`node --env-file=.env.local`, as today). Same UX,
  same born-closed check, candidate ids still title slugs so re-runs keep
  ballots valid (`on conflict (track, date) do update` on the poll).
- `scripts/seed-users.mjs` / `scripts/add-user.mjs`: rewrite to insert rows
  (or retire seed-users after Phase 1 — its job is done once users live in DB).
  Note `add-user.mjs` is currently UNTRACKED in the working tree (it was run
  once, 2026-07-24, adding the `aju` → `gibran` classroom directly to Blob);
  its DB rewrite should be committed. Those two users are picked up by the
  Phase-1 backfill like any other — it reads whatever is in `users/` at run
  time, never a hardcoded roster.
- `scripts/backup-blob.sh|mjs`: keeps backing up Blob (audio + article text —
  still needed). ADD `scripts/backup-db.sh` on the VM: nightly
  `pg_dump "$SUPABASE_DB_URL"` into the same dated-snapshot scheme, cron'd
  next to the blob backup. This also keeps the free project from idling.

## Backfill (one-time scripts, run per phase)

Idempotent by construction — safe to re-run:

1. **Users** (`scripts/migrate-users-to-db.mjs`): read `users/*.json` blobs →
   upsert rows (`on conflict (username) do update`), mapping
   `role: "teacher"→"parent"`, `teacherId→parent_id`. ~10 rows, seconds.
2. **Sessions** (`scripts/migrate-sessions-to-db.mjs`): read every
   `quiz-sessions/**/*.json` blob. Terminal records → upsert into
   `quiz_sessions` keyed on `source_blob` (the pathname), deriving
   `track` from the `junior/` path segment where the stamp is absent, `score`
   from `report.score`, `parent_id` from the stored `teacherId`. `-inprogress`
   slots → upsert into `quiz_slots`. ~120 rows, seconds. Blob records are
   **left in place** as a read-only archive (they're in the VM backups too);
   nothing deletes them.
3. **Votes** (optional, Phase 3): backfill old polls/ballots for the
   participation record, or let history live in the Blob archive and start
   fresh — owner's call; the site only ever reads the newest poll.

## Rollout order (each phase independently shippable + revertible)

**Phase 0 — provision.** Project, env vars, deps, `lib/db.ts`, `0001_init.sql`.
No behavior change; deployable immediately.

**Phase 1 — users.** Backfill users → swap `lib/users.ts` internals → verify
on a preview deploy (login each role, add/rename/reset a test student) → prod.
Fallback: the `AUTH_USERS` env fallback in `lib/auth.ts` already covers a
missing user mid-rollout (same transitional design as the original Blob
migration), and reverting the commit restores Blob reads (user blobs stay
current until Phase 4 — Phase 1 keeps `lib/users.ts` writes dual-target:
DB primary + best-effort blob write, dropped in Phase 4).

**Phase 2 — sessions + slots** (the perf payoff). One deploy swaps writers
(`quiz-report`, `quiz-progress`) and readers (`lib/sessions.ts`,
`quiz-session` GET/DELETE, `quiz-dates`, AdminSessions/DeleteSessionButton)
together — dual-running readers over two stores is more complex than the
brief window is worth at this scale. Order: run backfill → deploy → **re-run
backfill** (catches any session saved between the two; `source_blob` upsert
makes it a no-op otherwise). Verify on preview first: full quiz → End (report
card, Scores row, Details modal, recording playback), pause → Continue,
Start-over archive, owner Delete, student self-view scoping, junior track.
An in-flight quiz spanning the deploy at worst loses its slot continuity
(checkpoints land in the new store on the next answer) — acceptable; announce
the deploy window in the group chat. Fallback: revert the deploy; Blob
records are still there and still being backed up.

**Phase 3 — votes.** Swap the vote route + the two scripts; next poll opens in
DB. No overlap concerns (polls are short-lived and owner-initiated) — do it
between polls.

**Phase 4 — cleanup.** Remove: blob read/write paths for users/sessions/votes
(incl. Phase 1's dual-write), every `?v=` buster and CDN-staleness comment for
those stores, `AUTH_USERS`/`ADMIN_USERS` env fallback in `lib/auth.ts` (after
confirming all logins work from DB), `scripts/seed-users.mjs`. Update the
backup cron (add `backup-db.sh`). Rewrite the affected CLAUDE.md sections
(Architecture, Voice quiz storage notes, Daily vote storage, Deploy env vars,
Blob backups) — the store-specific workaround lore (uploadedAt keying,
list()-lag numbers, slot cache-busting) becomes historical and comes out.

## Decisions & risks

- **supabase-js (PostgREST) for app routes, `pg` for scripts** — serverless-
  safe, foliotracker-proven. Revisit direct Postgres only if a future feature
  needs multi-statement transactions beyond what an upsert/RPC covers.
- **RLS deny-all + service key only.** No anon key anywhere; the browser never
  talks to Supabase. Auth model (signed httpOnly cookie) unchanged.
- **Privacy improves**: session details (transcripts) move from
  public-but-unguessable blob URLs to an auth-scoped API. Audio stays on
  unguessable blob URLs (unchanged posture — revisit later if needed).
- **Free-tier pause**: defused by the nightly `pg_dump` cron; worst case a
  paused project un-pauses on first request with a cold-start delay.
- **What stays deliberately unsolved**: the client-side checkpoint-drain in
  `VoiceQuiz.finalizeQuiz` (an HTTP race, not a storage one — a late-landing
  checkpoint could still re-upsert a deleted slot; the drain already handles
  it); Blob-hosted audio durability (covered by the VM backup).
- **Effort**: Phase 0+1 ≈ a short session; Phase 2 is the bulk (routes +
  components + backfill + preview verification, iOS walk-through included);
  Phases 3–4 are small. Nothing here touches content authoring, the daily
  skills, or the static pages.
