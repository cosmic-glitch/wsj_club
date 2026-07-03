# Plan — Classrooms (per-teacher students & scoped scores)

Give each teacher their own set of students. A teacher manages only their own
students and sees only their own students' quiz sessions. Student accounts are
created/managed through the UI (not by editing an env var + redeploying).

**Decisions already made** (see `CLAUDE.md` › Voice quiz for the current model):

- **Storage:** Vercel Blob (the store already in use), behind a `lib/users.ts`
  repository interface so a later swap to a DB is a one-file change.
- **Teacher provisioning:** the **owner** provisions teachers (seed script /
  owner-only, not self-serve). **Teachers create students only** — never peers,
  never another classroom.

**Roster to seed (source of truth after Phase 1):**

| username | role    | teacherId | notes                                |
| -------- | ------- | --------- | ------------------------------------ |
| anurag   | teacher | —         | **owner** (may also create teachers) |
| madan    | teacher | —         | second teacher                       |
| arjun    | student | anurag    |                                      |
| anusha   | student | anurag    |                                      |
| samaira  | student | anurag    |                                      |
| mehar    | student | anurag    |                                      |
| puneeth  | student | madan     |                                      |
| test     | ?       | ?         | pre-existing throwaway — **decide**  |

**All of these already exist in `AUTH_USERS`** (verified:
`anurag, anusha, samaira, arjun, mehar, test, puneeth, madan`), and
`ADMIN_USERS=anurag,madan` — so **both** teachers are admins today and currently
see *every* student's sessions (the exact problem this change fixes). The seed
therefore **reuses the bcrypt hashes already in `AUTH_USERS` for everyone** — no
new passwords. The only open item is the leftover **`test`** account: assign it
to a teacher, or seed it `active:false` (recommended) so it can't log in but
isn't deleted.

Phase 3 (named/multiple classrooms per teacher, owner "Add teacher" UI,
per-student stats) is **out of scope** for now.

---

## Data model

A single new entity — the **User record**. "Classroom" is implicit: a teacher's
classroom is every user with `teacherId === <teacher>`.

```ts
// lib/users.ts
export type UserRole = "teacher" | "student";

export type User = {
  username: string;        // login id, globally unique, lowercased
  displayName: string;     // shown in the UI, e.g. "Anusha"
  passwordHash: string;    // bcrypt (bcryptjs, 10 rounds) — as today
  role: UserRole;
  teacherId?: string;      // students: owning teacher's username; teachers: unset
  active: boolean;         // soft-delete: false blocks login, keeps history
  createdBy?: string;      // audit — who created this record
  createdAt: string;       // ISO
};

// The shape safe to send to the browser (never the hash).
export type PublicUser = Omit<User, "passwordHash">;
```

**Owner** is a thin tier above teacher: kept in an `OWNER_USERS` env var
(comma-separated, fail-closed — same pattern as today's `ADMIN_USERS`). An owner
is a teacher who may *also* create teachers. Seed value: `OWNER_USERS=anurag`.
No `role: "owner"` on the record — owner-ness is an env capability, so it can't
be granted by writing a Blob.

### Blob layout

```
users/<username>.json          one blob per user, deterministic pathname
                               (put with addRandomSuffix:false so lookup is by key)
```

- **Reads** use the Blob API (`list({ prefix: "users/" })` + `fetch(url,
  { cache: "no-store" })`), never a long-lived cached URL. Login can scan
  `users/` — trivially small.
- **Create** = list-then-check for uniqueness, then `put`.
- **Consistency caveat:** overwrite-in-place (a *password reset*) can serve a
  stale copy via the CDN for ~60s. New-student *creation* has no prior cached
  copy, so it's immediately readable (the common path). Documented, not
  engineered around unless it bites.

---

## Phase 1 — backing swap (no visible change)

Goal: users/roles/classroom come from Blob instead of env vars, sessions get a
`teacherId`, and `/admin` + delete scope to the caller's own students. Behavior
for the four existing students is **identical**; this is a safe first commit.

### 1.1 `lib/users.ts` (new — the repository)

The only module that touches user blobs. Interface (swap target for a future DB):

```ts
getUser(username): Promise<User | null>
verifyLogin(username, password): Promise<User | null>   // null if bad creds OR inactive
listStudents(teacherId): Promise<PublicUser[]>          // for a teacher's roster
listTeachers(): Promise<PublicUser[]>                   // owner use (Phase 2+)
createUser(input, createdBy): Promise<PublicUser>       // enforces unique username
setPassword(username, newPassword): Promise<void>
rename(username, displayName): Promise<void>
setActive(username, active): Promise<void>
```

- All writes go through here; all hashing (bcryptjs) lives here.
- `createUser` validates: username matches `^[a-z0-9_-]{3,}$`, is globally unique
  (case-insensitive), and `role`/`teacherId` are consistent (a student must have
  a `teacherId`; a teacher must not).
- **Optional** tiny per-instance cache (Map + ~30s TTL) to avoid a Blob read on
  every gated request. Keep freshness short so deactivation/reset take effect
  quickly. Add only if request latency warrants it.

### 1.2 `lib/auth.ts` (rewire to the repo; keep the cookie code)

The cookie/HMAC machinery is unchanged. Only the **source of user facts** moves.

- `verifyCredentials(username, password)` → delegate to `verifyLogin` (which also
  rejects inactive users). Keep the exported name so `app/api/login` is untouched.
- **Split `readSessionToken`:** it becomes a **pure HMAC check** returning the
  username the cookie encodes (no user-exists lookup — that was the only sync use
  of `getUsers()`). Move the "user still exists & is active" check into
  `currentUser`, which is already async and can `await getUser(...)`.
- `isAdmin(username)` → **becomes async**: `true` if the user's `role === "teacher"`
  (via `getUser`) **or** the username is in `OWNER_USERS`. Update the 3 call
  sites (all already in async contexts): `app/admin/page.tsx:88`,
  `app/api/quiz-session/route.ts:13`, `app/api/me/route.ts:8`.
- Add helpers: `isOwner(username)` (env `OWNER_USERS`), `currentUserRecord():
  Promise<User | null>` (cookie → record, for role/teacherId), and keep
  `isAdmin` meaning "may see the teacher area."
- **Transitional fallback (removable after verification):** if a username isn't
  found in `users/` yet, fall back to the old `AUTH_USERS`/`ADMIN_USERS` env
  parse, so a mid-rollout gap can't lock anyone out. Delete this fallback once
  the seed is confirmed in production.

### 1.3 Seed / migration script (`scripts/seed-users.mjs`, one-time, not committed to run)

- Reads `AUTH_USERS` (base64 JSON) — **every user already has a hash there**, so
  the seed reuses them all; no plaintext passwords are handled.
- Writes `users/<username>.json` for each row in the roster table above:
  - Teachers: `anurag`, `madan` (from `ADMIN_USERS`) → `role: "teacher"`.
  - Students `arjun/anusha/samaira/mehar` → `teacherId: "anurag"`;
    `puneeth` → `teacherId: "madan"`.
  - `test` → seed `active:false` (or assign to a teacher) per the decision above.
- **Idempotent:** re-running overwrites the same keys (no random suffix), so it's
  safe to run again.
- Set env: `OWNER_USERS=anurag` in Vercel (Production + Preview) and `.env.local`.
- `AUTH_USERS` / `ADMIN_USERS` stay set during rollout (the fallback), retired
  after verification.

### 1.4 Stamp `teacherId` on saved sessions (`app/api/quiz-report/route.ts`)

- After resolving `user` (the student login), look up their record and store
  `teacherId` on the session JSON alongside `loginUser` (around line 187–201).
- Old sessions won't have it → the `/admin` filter falls back to roster
  membership (below), so nothing historical is lost.

### 1.5 Scope `/admin` to the caller's own students (`app/admin/page.tsx`)

- Replace "admin sees everything" (line 96–101) with a **roster filter**:
  - Load the caller's students once: `const mine = new Set((await
    listStudents(user)).map(s => s.username))`.
  - A session is visible to the teacher iff `s.teacherId === user` **or**
    (`s.teacherId` unset **and** `s.loginUser ∈ mine`) — the second clause covers
    un-stamped historical sessions.
  - A student still sees only their own (unchanged), cancelled still hidden.
- Owner is scoped the **same way** (own students only) — the stated requirement
  is "admins see only their own students." (A global owner view is a Phase 3
  option, deliberately not built.)
- Headings unchanged ("Quiz sessions" for a teacher, "Your scores" for a student).

### 1.6 Ownership check on delete (`app/api/quiz-session/route.ts`)

- Still teacher-gated. Add: **fetch the session JSON first**, verify its
  `teacherId === user` (or, for un-stamped blobs, `loginUser ∈ listStudents(user)`),
  and only then `del()`. A teacher must not be able to delete another classroom's
  session even with a hand-crafted URL. Keep the existing `quiz-sessions/` prefix
  guard.

### 1.7 Extend `/api/me` + `AuthProvider`

- `/api/me` returns `{ username, displayName, role, teacherId, isAdmin, isOwner }`
  (await the now-async `isAdmin`).
- `components/AuthProvider.tsx` carries the added fields (role/isOwner) so Phase 2
  can gate UI without a second fetch. `isAdmin` stays the gate for the Scores/teacher
  area.

### Phase 1 — verify & ship

- `npm run build` clean (TS: the async `isAdmin` ripple resolved at all 3 sites).
- Locally: seed against `.env.local`, then confirm — `anurag` sees only his 4
  kids' sessions; `madan` sees only `puneeth`; each student sees only their own;
  logged-out still blocked; delete refuses a cross-classroom URL.
- Commit + push (auto-deploys). Run the seed against production Blob, set
  `OWNER_USERS`, re-verify on the live site, then remove the transitional env
  fallback in a follow-up commit.

---

## Phase 2 — the management UI

Goal: a teacher creates and manages their own students in the browser.

### 2.1 Routes & tabs

Keep `/admin` a server component. Add a sibling route rather than client tab state:

- `app/admin/page.tsx` — **Scores** (existing, now scoped).
- `app/admin/students/page.tsx` — **Students** (new; teacher-gated, `listStudents(me)`).
- `components/AdminTabs.tsx` — a small link bar (`Scores` · `Students`) rendered
  at the top of both, shown only when `isAdmin`. Students see no tabs.

### 2.2 `app/api/students` (teacher-gated CRUD)

- `POST /api/students` — create a student.
  - Auth: caller must be a teacher/owner (`isAdmin`).
  - Body: `{ displayName, username, password }`.
  - **`teacherId` is forced to the caller server-side** — never read from the body.
  - Validates format + global uniqueness (409 on collision, with a suggested
    alternative like `anusha2`). Hashes the password via `lib/users.ts`.
  - Returns the `PublicUser` (never the hash). The plaintext is only ever known
    client-side (typed or generated there), so nothing sensitive is echoed back.
- `PATCH /api/students/[username]` — `{ action: "rename" | "resetPassword" |
  "setActive", ... }`.
  - **Ownership check on every action:** `target.teacherId === caller` (owner is
    not exempt — it manages its own students only, consistent with Phase 1 scoping).
- Deactivate (soft-delete) is `setActive:false` — blocks login, preserves the
  student's saved sessions and their visibility to the teacher.
- Optional `GET /api/students/available?username=` for the live uniqueness hint;
  otherwise validate on submit.

### 2.3 `components/StudentRoster.tsx` (client)

The Students-tab table + interactions; calls the API and `router.refresh()`es.

```
┌──────────────────────────────────────────────────────────────┐
│  [ Scores ]   [ Students ]                                     │
├──────────────────────────────────────────────────────────────┤
│  My Classroom                                 [ + Add student ]│
│                                                                │
│  Student    Username   Attempts  Last active   Actions         │
│  ────────────────────────────────────────────────────────────  │
│  Anusha     anusha         7      2 days ago    ⋯               │
│  Samaira    samaira        4      today         ⋯               │
│  Arjun      arjun          9      today         ⋯               │
│  Mehar      mehar          2      1 week ago     ⋯               │
│                                                                │
│  ⋯ = Reset password · Rename · Remove (deactivate)             │
└──────────────────────────────────────────────────────────────┘
```

- **Attempts / Last active** come from the sessions the page already loads
  (`listStudents` joined with the session groups), so no extra data source.
- **Add student modal:** Display name → Username (auto-suggested from the name,
  lowercased; live "✓ free / ✗ taken") → Password (typed, or a **Generate**
  button that makes a memorable password client-side). On success, a **one-time
  credential card** shows username + password with copy buttons and "the password
  won't be shown again."
- **Reset password:** same one-time reveal. **Rename:** inline. **Remove:**
  confirm → deactivate (native `confirm()`, matching the admin Delete pattern).

### 2.4 Header

No change needed — the header **Scores** link already points to `/admin` for
every logged-in user; the teacher tabs live inside it. (Optionally relabel the
teacher's link, but not required.)

### Phase 2 — verify & ship

- `madan` logs in → Students tab shows only `puneeth`; can add a second student,
  reset `puneeth`'s password, deactivate/reactivate; **cannot** see or touch
  `anurag`'s students (verify the ownership 403 with a hand-crafted `PATCH`).
- Created student can immediately log in and take a quiz; their session appears
  under the right teacher's Scores.
- `npm run build` clean; commit + push.

---

## Security model (both phases)

- **Passwords:** bcrypt-only (bcryptjs, 10 rounds), never stored or returned in
  plaintext; the one-time reveal is client-side knowledge, not a server echo.
- **`teacherId` is server-authoritative** on create — a client can't place a
  student in another classroom.
- **Every student mutation and every session view/delete checks ownership**
  (`target.teacherId === caller`); owner included (owner ≠ god over other
  classrooms — it only gains *teacher creation*, which is Phase 3 / script-only).
- **Fail closed:** no `users/` record and no env fallback ⇒ no login; unset
  `OWNER_USERS` ⇒ nobody can create teachers.
- **Usernames are global** (login is by username) and uniqueness is enforced
  server-side.

## Out of scope (Phase 3, not now)

Named/multiple classrooms per teacher, an owner "Add teacher" UI (teachers stay
script-provisioned), per-student analytics, and any global cross-classroom owner
view.

## Docs

Update `CLAUDE.md` (the Voice-quiz / auth sections and the file-layout list) as
part of each phase's commit — the working agreement requires it.
