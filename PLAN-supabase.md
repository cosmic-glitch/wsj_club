# PLAN: Migrate structured data from Vercel Blob to Supabase (Postgres)

_Reviewed against main through `fd11016` (2026-07-25): the commits since the
plan first landed are content/authoring-side (the 07-25 reading; article pages
now captured for open sources too; no-byline titles) and don't touch the data
layer — nothing here changes because of them._

_Revised 2026-07-25 (owner): the rollout is now a **dual-write shadow
migration** — Blob stays the production store while the DB mirrors it in real
time, reads flip only after a verified soak, and Blob writes stop last. The
old plan's hard cutover for sessions (one deploy swapping writers + readers)
is superseded._

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
| `users/<username>.json`                           | `rc_users` table   |
| `quiz-sessions/[junior/]<date>/<name>-<rand>.json` (terminal sessions) | `rc_quiz_sessions` table |
| `quiz-sessions/[junior/]<date>/<name>-inprogress.json` (pause/resume slot) | `rc_quiz_slots` table |
| `votes/[junior/]<date>/poll.json`                 | `rc_polls` table   |
| `votes/[junior/]<date>/ballots/<name>.json`       | `rc_ballots` table |

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

1. **Shared Supabase project** — reuse the existing `whisper-anywhere`
   project (owner's call, 2026-07-25: the free plan allows 2 projects and
   both slots are taken — foliotracker + whisper-anywhere). Isolation is by
   table prefix: **every Reading Club table is `rc_*`**. The service key is
   shared with whisper-anywhere's website API — acceptable: both are the
   owner's server-side apps, and neither exposes the key to a browser.
   Free-tier pause-on-idle is defused by whisper-anywhere's own traffic plus
   the nightly `pg_dump` cron (below).
2. **Env vars** (Vercel Production + Preview, and `.env.local`):
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (app routes) — copied from
   `../whisper-anywhere/website/.env.local` (there the key is named
   `SUPABASE_SERVICE_ROLE_KEY`) — and `SUPABASE_DB_URL` (direct Postgres
   connection string, scripts/migrations only — from the Supabase dashboard,
   Settings → Database; local + VM, never needed in Vercel). Never expose an
   anon key; there is no browser-side Supabase access.
3. **Deps**: `pg` (devDependency — migrations only). The app deliberately
   does NOT use `@supabase/supabase-js`: current versions (2.110+) construct
   a realtime client requiring Node 22's native WebSocket even when realtime
   is never used — a silent landmine for local scripts (this machine runs
   Node 21) and any runtime drift. Everything we need is three HTTP verbs.
4. **`lib/db.ts`**: a minimal fetch-based PostgREST client —
   `dbSelect`/`dbUpsert`/`dbDelete` against `$SUPABASE_URL/rest/v1/` with the
   service key. Best-effort by design (logs + returns null/false, never
   throws — the shadow-write contract), and a no-op when the env vars are
   absent. `scripts/db-rest.mjs` is the scripts-side twin (loud — throws).
   No connection pooling to manage in serverless.
5. **Migrations**: `supabase/migrations/0001_init.sql`, applied with
   `node --env-file=.env.local scripts/apply-migration.mjs <file>` (a small
   `pg` runner — no local `psql` install). RLS is ENABLED on every `rc_*`
   table with **no policies** — deny-all for anon/authed roles; only the
   service key (which bypasses RLS) can touch data. (whisper-anywhere's own
   tables are untouched; migrations here only ever create/alter `rc_*`.)

## Schema

```sql
-- All tables rc_-prefixed: the project is shared with whisper-anywhere.
create table rc_users (
  username      text primary key,                -- login id, lowercased
  display_name  text not null,
  password_hash text not null,                   -- bcrypt, as today
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
  source_blob  text unique,                      -- backfill provenance + idempotency; null on new rows
  created_at   timestamptz not null default now()
);
create index rc_quiz_sessions_by_user  on rc_quiz_sessions (login_user, date);
create index rc_quiz_sessions_by_scope on rc_quiz_sessions (parent_id);

create table rc_quiz_slots (                        -- the pause/resume slot
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

_This section describes the **end state** (after Phase 4). The rollout stages
it: Phase 1 adds a shadow DB write **alongside** each module's existing Blob
I/O, Phase 3 flips the read paths, and only Phase 4 deletes the Blob code
described as "DELETE" below._

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
(no transcript/report/diag) over `rc_quiz_sessions` UNION the `rc_quiz_slots` rows
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
`rc_quiz_sessions` (archiving the slot, audio blob copied to a permanent key as
today) + delete the slot row, in one transaction via a small
`archive_slot` SQL function (or sequential with the insert first — same order
as today's copy-then-delete).

**`app/api/quiz-report`**: terminal save inserts into `rc_quiz_sessions` then
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

**`app/api/quiz-dates`**: `select distinct date from rc_quiz_sessions where …` —
or keep filtering `loadSessions()` output; either is fine, the data is small.

**`app/api/vote`**: GET → newest poll for the track (one query), active iff no
reading exists for its date (unchanged derivation, still checked against
`content/`); caller's ballot + tally via two more cheap queries (`count(*)
group by candidate_id`). POST → upsert into `rc_ballots`. All vote-blob
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
  `pg_dump "$SUPABASE_DB_URL" --table='rc_*'` (ONLY our tables — the project
  is shared with whisper-anywhere, whose data has its own backup story) into
  the same dated-snapshot scheme, cron'd next to the blob backup. This also
  keeps the free project from idling.

## Backfill + verification scripts

Idempotent by construction — safe to re-run. During the shadow period the
backfill doubles as the **reconciler**: Blob is authoritative until Phase 4,
so re-running it after fixing a shadow-write bug trues the DB up (an
overwrite from Blob is always safe — the Blob copy is never staler than its
DB shadow, since every write lands in Blob first):

1. **Users** (`scripts/migrate-users-to-db.mjs`): read `users/*.json` blobs →
   upsert rows (`on conflict (username) do update`), mapping
   `role: "teacher"→"parent"`, `teacherId→parent_id`. ~10 rows, seconds.
2. **Sessions** (`scripts/migrate-sessions-to-db.mjs`): read every
   `quiz-sessions/**/*.json` blob. Terminal records → upsert into
   `rc_quiz_sessions` keyed on `source_blob` (the pathname), deriving
   `track` from the `junior/` path segment where the stamp is absent, `score`
   from `report.score`, `parent_id` from the stored `teacherId`. `-inprogress`
   slots → upsert into `rc_quiz_slots`. ~120 rows, seconds. Blob records are
   **left in place** as a read-only archive (they're in the VM backups too);
   nothing deletes them.
3. **Votes** (optional): backfill old polls/ballots for the participation
   record, or let history live in the Blob archive and start fresh — owner's
   call; the site only ever reads the newest poll. (The CURRENT poll, if one
   is live when Phase 1 ships, must be backfilled so the read-flip doesn't
   lose it.)
4. **Diff** (`scripts/diff-blob-db.mjs`, new — the Phase 2 gate): list every
   structured blob (`users/`, `quiz-sessions/**/*.json`, `votes/`), fetch its
   DB twin (sessions matched by `source_blob`, slots by their PK, users/polls/
   ballots by key), and compare field-by-field; report missing rows, orphan
   rows, and divergent fields. A clean run taken while the site is in active
   use is what proves the shadow write path.

## Rollout order (dual-write shadow → verify → flip reads → retire Blob)

The principle: **Blob stays the production store until the DB has proven
itself in real time.** The site never goes offline and no deploy window
matters — students can be mid-quiz through every phase. Every step before
Phase 4 is trivially revertible because Blob is still being written
throughout; Phase 4 runs only after the DB has been the read path for days.

**Phase 0 — provision.** Project, env vars, deps, `lib/db.ts`, `0001_init.sql`.
No behavior change; deployable immediately. _DONE 2026-07-25: schema applied
to the shared project (via the us-west-2 session pooler — the direct
`db.<ref>` host is IPv6-only and unreachable from the owner's network;
`SUPABASE_DB_URL` in `.env.local` uses the pooler)._

**Phase 1 — shadow writes + backfill (the DB becomes a live mirror).** Every
writer of structured data dual-writes: the Blob write stays EXACTLY as today
(still what production reads), plus a **best-effort DB write** — wrapped so a
DB failure can never break a login, a checkpoint, a save, or a vote; it just
`console.error`s (drift is caught by the diff + healed by the reconciler, so
best-effort is safe). One deploy covers all the stores at once:

- **users** — create / rename / reset / deactivate upsert the row too
  (`lib/users.ts` writes grow the shadow; reads untouched).
- **terminal sessions** — `quiz-report` also inserts into `rc_quiz_sessions`,
  stamping `source_blob` with the blob pathname so every DB row is matched to
  its Blob twin (same key the backfill uses — a row is written once, by
  whichever runs first).
- **slots** — `quiz-progress` POST also upserts `rc_quiz_slots`; the terminal
  save and DELETE (start-over archive) delete/archive the DB slot too.
- **owner Delete** — `quiz-session` DELETE (still keyed by blob URL) also
  deletes the matching DB row (by `source_blob`), so a deletion can't
  resurrect at the read-flip.
- **votes** — `open-vote.mjs` writes the poll row too; the vote POST upserts
  the ballot row too.

Then run the one-time backfill (users + sessions + slots + the live poll).
From here the DB holds all history AND tracks production in real time.
_DONE 2026-07-25: shadow writes shipped; backfill ran (22 users, 128 terminal
sessions, 1 slot, 1 poll); first full diff came back clean — and the diff's
first run caught a live event (a student's in-progress slot created mid-
backfill), confirming both the tooling and the "no deploy window needed"
premise._

**Phase 2 — verify the mirror (~a day of real use).** Run
`scripts/diff-blob-db.mjs` (see Backfill + verification) a few times across a
normal day of quizzing — including after today's sessions land. Drift found →
fix the shadow-write bug, re-run the backfill (the idempotent upserts double
as the reconciler; Blob is authoritative, so overwriting from it is always
safe), diff again. **Gate: a clean diff taken while the site is in active
use.** No deploy in this phase.

**Phase 3 — flip reads.** One deploy swaps the READ paths to the DB:
`lib/users.ts` lookups, `lib/sessions.ts` (`loadSessions` → the slim select),
`readSlot`→`getSlot` in the progress GET, `quiz-dates`, the vote GET, plus the
reader-shaped code that rides along (`quiz-session` grows GET `?id=`,
AdminSessions/DeleteSessionButton switch from `blobUrl` to `id`). Writers
still dual-write, so Blob remains current — **reverting this deploy is a
zero-data-loss rollback**, and an in-flight quiz spanning the deploy keeps
its slot continuity (the slot is already in both stores). Verify on preview
first: full quiz → End (report card, Scores row, Details modal, recording
playback), pause → Continue, Start-over archive, owner Delete, student
self-view scoping, junior track, vote cast/change/tally. iOS walk-through
included.
_DONE 2026-07-25 (owner accepted prod-direct testing over a preview pass —
the dual-write makes revert zero-loss): all readers flipped, with a
DB-first/Blob-fallback in the login loader and the slot readers (the
fallback dies in Phase 4). Verified against the live DB on a local dev
server with minted session cookies: owner/parent/student Scores renders,
quiz-dates, vote GET, slot checkpoint→probe→delete round-trip through both
stores, and the GET ?id= scoping matrix (owner any / parent own-classroom
only / student own only / 401 logged-out / 400 bad id). Remaining holes: a
real end-to-end quiz on prod (mic → End → report card) and the iOS
walk-through — watch the first real quiz after the flip._

**Phase 4 — retire the Blob copies (after Phase 3 soaks a few days).**
Remove: the Blob write paths for users/sessions/slots/votes (the shadow
scaffolding — DB writes stop being "shadow" and become the only writes; they
graduate from best-effort to error-surfacing), every `?v=` buster and
CDN-staleness comment for those stores, `AUTH_USERS`/`ADMIN_USERS` env
fallback in `lib/auth.ts` (after confirming all logins work from DB),
`scripts/seed-users.mjs`, `scripts/diff-blob-db.mjs`. Existing blob records
stay in place as a read-only archive (and in the VM backups) — nothing
deletes them. Update the backup cron (add `backup-db.sh`). Rewrite the
affected CLAUDE.md sections (Architecture, Voice quiz storage notes, Daily
vote storage, Deploy env vars, Blob backups) — the store-specific workaround
lore (uploadedAt keying, list()-lag numbers, slot cache-busting) becomes
historical and comes out.

## Decisions & risks

- **Plain-fetch PostgREST for app routes AND scripts, `pg` for DDL only** —
  serverless-safe, zero runtime requirements (supabase-js was dropped in
  Phase 0 for its Node-22 native-WebSocket requirement). Revisit direct
  Postgres only if a future feature needs multi-statement transactions beyond
  what an upsert/RPC covers.
- **RLS deny-all + service key only.** No anon key anywhere; the browser never
  talks to Supabase. Auth model (signed httpOnly cookie) unchanged.
- **Shared project with whisper-anywhere** (free-plan cap). The `rc_` prefix
  is the isolation boundary: our migrations/scripts/backups only ever touch
  `rc_*` tables. The shared blast radius is the service key (either app could
  technically read the other's tables) and the free-tier resource pool — both
  acceptable for two low-traffic personal apps; revisit if either grows.
- **Privacy improves**: session details (transcripts) move from
  public-but-unguessable blob URLs to an auth-scoped API. Audio stays on
  unguessable blob URLs (unchanged posture — revisit later if needed).
- **Free-tier pause**: defused by the nightly `pg_dump` cron; worst case a
  paused project un-pauses on first request with a cold-start delay.
- **Shadow writes are best-effort by design.** A partial failure (Blob ok,
  DB errored) is drift, not data loss — Blob is authoritative until Phase 4,
  the diff script surfaces it, and the idempotent backfill heals it. The
  alternative (fail the request when the shadow write fails) would let a DB
  hiccup break a live quiz for zero benefit during the mirror period.
- **The shadow period proves the write path, not the read path.** The new
  readers only run when Phase 3 flips them — which is why the full preview-
  deploy verification checklist stays on Phase 3 regardless of how clean the
  Phase 2 diffs were.
- **What stays deliberately unsolved**: the client-side checkpoint-drain in
  `VoiceQuiz.finalizeQuiz` (an HTTP race, not a storage one — a late-landing
  checkpoint could still re-upsert a deleted slot; the drain already handles
  it); Blob-hosted audio durability (covered by the VM backup).
- **Effort**: Phase 0 ≈ an hour; Phase 1 is the bulk of the writing (shadow
  writes across five stores + backfill + diff script); Phase 2 is calendar
  time, not work; Phase 3 is the reader swap + the full preview verification
  (iOS walk-through included); Phase 4 is deletion + docs. One more deploy
  than a hard cutover, in exchange for every step being revertible with the
  site live throughout. Nothing here touches content authoring, the daily
  skills, or the static pages.
