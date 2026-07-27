@AGENTS.md

# WSJ Reading Club

A daily reading-handout website for a small club of kids. Each day = one article (WSJ / Economist / an enrichment source) turned into a study handout — **Words to know** and **Concepts behind the story** — plus a self-quiz page and an AI **voice quiz**. Goal: general knowledge, vocabulary, conceptual understanding. Two tracks share the site: **senior** (US grades 8–10, at `/`) and **junior** (grades 5–7, at `/junior`, occasional).

Live: https://wsjclub.vercel.app · Repo: https://github.com/cosmic-glitch/wsj_club

## Working agreement

- **Commit and push every logical change.** Push to `main` auto-deploys to Vercel — pushing is shipping. Don't leave requested changes uncommitted (throwaway experiments excepted).
- **Keep this file current — by replacing, not appending.** Record decisions, invariants, and workflows only. Never add change history, dates of changes, reversal narratives, or per-component UI detail — git history and the code hold those. Deep rationale for a subsystem goes in a `PLAN-*.md`, linked from here. If an entry here duplicates what reading the code would tell you, delete it.

## Architecture

- **Next.js** (App Router, Next 16, React 19, Tailwind v4). Daily content is **data, not code**: one JSON per day in `content/` (senior) / `content/junior/`. Content pages (index, handout, self-quiz, word bank) are **statically generated**; the voice quiz adds dynamic API routes and the admin pages.
- **Roles:** every login is a **parent** (the grown-up role — historically "teacher") or a **student** with a `parentId`. A parent sees/manages only their own classroom; the **owner** (env `OWNER_USERS`) additionally sees every classroom, may delete any attempt, and may add students to any classroom (rename/reset stay own-classroom for everyone). See `PLAN-classrooms.md`.
- **Tracks:** `type Track = "senior" | "junior"` (`lib/content.ts`). `date` is NOT unique across tracks. Senior keeps bare paths; junior inserts a `junior/` segment everywhere (content, article pages, audio, article-text, Blob keys, routes). Shared components (`LandingIndex`, `Handout`, `SelfQuiz`, `VoiceQuiz`, `WordBank`) take a `track` prop; each track's routes are thin wrappers around them. See `PLAN-junior.md`.
- **Storage:** Vercel Blob holds users, quiz sessions + in-progress slots, votes, recordings, and article text. **Migration to Supabase Postgres is in progress** (`rc_*` tables in the shared whisper-anywhere project): the dual-write shadow AND the read flip are live — production reads the DB, with Blob fallback. See `PLAN-supabase.md`.
- **Design language:** brutalist — Anton display + Space Mono labels (`app/fonts.ts`), white canvas, near-black ink, signal-yellow accent, thick square borders, hard offset shadows, hover inversion.

### Where things live

- `content/` — one JSON per day (+ `junior/`), plus `content/announcement.json` (home-page banner, edited in place)
- `public/articles/` — served self-contained HTML article pages, one per day, captured by the wsj-reading skill (every day has one; it's what makes the glossary possible)
- `public/glossary.js|css` + `public/glossaries/` — the article pages' tap-a-word glossary: pre-baked JSON per page, authored by Claude in the skill (no runtime API); validate with `scripts/check-glossary.mjs`, tag pages with `scripts/add-glossary-tags.mjs`
- `public/audio/<date>/` — pronunciation clips for vocab/concepts (`scripts/gen-pronunciation.mjs`) + `gloss/` glossary clips (`scripts/gen-glossary-audio.mjs`)
- `article-text/` — gitignored drop-zone for full article text → uploaded to Blob for the tutor (`scripts/upload-article-text.mjs`)
- `app/` — routes (thin wrappers) + API routes; `app/admin/` = Scores + Manage Students
- `components/` — the shared page bodies and client widgets
- `lib/` — content schema/loader (`content.ts`), auth (`auth.ts`, `users.ts`), tutor + grader prompts (`quiz-prompt.ts`, `grading-examples.ts`, `score.ts`), session helpers (`sessions.ts`, `session-io.ts`), rich text (`rich-text.tsx`), DB (`db.ts`, `shadow.ts`)
- `scripts/` — daily-flow CLIs (upload-article-text, gen-pronunciation, gen-glossary-audio, add-glossary-tags, check-glossary, open-vote, check-vote) + admin/ops (add-user, seed-users, hash-password, backup-blob, DB migrations)
- `.claude/skills/` — the daily workflow (pickers, vote open/check, authoring for both tracks)

## Content rules (invariants for ANY session that touches content)

The card recipes, calibration, and counts live in the authoring skills — `.claude/skills/wsj-reading/SKILL.md` (junior: `wsj-reading-junior/`), the single source of truth; read the relevant skill before writing or reshaping a day's content, even by hand. Content types are in `lib/content.ts` (`pdfUrl` is legacy and unused). What must hold everywhere, skill or not:

- **Hard rule: never republish article text.** Link and quote short phrases only. Full text goes to Blob (private, for the tutor) — never into the repo.
- **No author byline in `title`** — an index-row rule only; attribution in prose, glossaries, and the article page's SOURCE bar is fine and wanted.
- **Never pad concepts** — up to 3, fewer is fine, and `[]` (vocab-only day) is handled everywhere.
- Inline `**bold**`/`*italic*` in authored prose renders via `lib/rich-text.tsx` (parses to React elements, never `dangerouslySetInnerHTML`); `quiz-prompt.ts` strips markers before feeding models/TTS.

## Invariants & gotchas (the load-bearing lessons)

- **`track` is a REQUIRED param** on `sessionPrefix` + every slot/vote path helper — no `"senior"` default. A defaulted helper silently computes the senior path at a junior call site, and best-effort writes make that failure invisible.
- **Identity always comes from the signed cookie, never the request body.** Blob keys derived from a name are overwritable — a body-derived name could stomp another user's slot/ballot. `track` in a request is only a label.
- **Cache-bust every read of an overwritten-in-place blob** (slots, users, votes, flushed audio): unique `?v=` per read. The Blob CDN edge cache AND `list()`'s `uploadedAt` lag behind overwrites.
- **Storage still says "teacher".** User blobs store `role: "teacher"` + `teacherId`; sessions stamp `teacherId`. The parent rename happens only at the storage boundaries (`lib/users.ts` `fromStored`/`toStored`, `lib/sessions.ts`, the session-writing routes). Keep stored records byte-compatible.
- **Voice-quiz endings:** End appears only when the tutor's `done` flag is set; failures/hangs **pause** (checkpointed slot, retryable), never finalize; only End and Cancel are terminal, both through the once-guarded `finalizeQuiz` with run-id fencing on every async step. Nothing is graded until End; Cancel saves an ungraded `cancelled` attempt (parent-only). Background: `BUG-anusha-voice-quiz.md`, `PLAN-continue-voice-quiz.md`.
- **Handout/WordBank stay server components** — they fs-check `public/audio/` at build time (`lib/handout-audio.ts`); a dynamic render can't see those files on Vercel. `slugify()` there must match `scripts/gen-pronunciation.mjs`. The general recipe for personal/live bits on static pages: server-render the page, hydrate a small client leaf that fetches once (TodayTag/VotePoll/CompletedBy/StreakStrip/WordBankList all follow it — never a fetch per row).
- **Vote "active" is derived, never a flag:** a track's newest poll is live iff no reading exists for its date on that track — publishing the reading is what closes the vote. Site shows counts, never voter names; the per-candidate tally only after you've voted.
- **Mono is the label layer only** (chips, buttons, table headers). Sentence-length text uses `font-sans` — mono prose reads badly.
- **`OWNER_USERS` fails closed:** unset in an environment silently downgrades the owner to a plain parent (this bit once in prod). Env-var changes need a redeploy to take effect.
- **Grading:** calibration anchors in `lib/grading-examples.ts` (anchors from the graded day/track are excluded), `applyLeniency` +1 in `lib/score.ts`, the grader never sees the student's name, only `student` turns are gradable (zero answers → honest `"—"`, model skipped). To recalibrate, promote a comparative review into a new anchor. The report card is `{score, feedback}` — a few teacher-voice paragraphs addressed to the student, at most two meaty corrections, never ending in "go review X"; **legacy records keep the old summary/strengths/gaps shape and both renderers must keep handling both** (no backfill).
- **Recording is platform-split** (`VoiceQuiz.tsx`): desktop records the Web Audio graph *output* via MediaRecorder (recording the raw mic track while an AudioContext reads it captures silence — Chromium bug); iOS captures raw PCM→WAV via ScriptProcessor with a **fresh mic per answer** (iOS mutes a long-lived track after TTS playback). All clips and the stitched teacher WAV go **direct-to-Blob** via client upload tokens — a multipart body through the function 413s at ~4.5MB.
- The client's fixed `openingLine()` must mirror step 1 of `buildInstructions` (`lib/quiz-prompt.ts`) — the greeting skips the model and the TTS API entirely. Its spoken audio is the pre-generated per-day `public/audio/[junior/]<date>/quiz-intro.mp3` (tutor voice naming the article title; made by `gen-pronunciation.mjs`, whose intro text must stay the opening line's first sentences). Missing clip → silent, text-only opening.
- The tutor replies as `{text, done}` JSON; the route extracts the first balanced `{…}` (models sometimes emit extra JSON/prose — a plain `JSON.parse` once leaked raw JSON into spoken TTS).
- Every saved session carries `diag` (sessionId/mountId/endReason/breadcrumbs) — a permanent tripwire for double-saves/remounts. Quiz-route failures log the login user.

## Voice quiz (summary)

An AI tutor orally quizzes the student on the day's article in a modal: TTS question → student presses **Start/Stop** to record → transcribe → chat model picks the next turn (key-ideas retelling → vocab → concepts → wrap-up), then a graded report card is saved for the parent and shown to the student. **Turn-taking is button-driven, never inferred** (the earlier realtime/VAD build was scrapped as unreliable). The transcript checkpoints after every turn into a per-(student, date) in-progress slot — leaving or a failure just **pauses**; resume via the launcher chooser or the Scores page's Continue link, with cross-resume audio stitched into one WAV. The tutor and grader get the full article text from Blob. Scores page (`/admin`): students see their own attempts, parents their classroom, the owner everything (Regular/Junior tabs). Models/voice are env knobs (`TUTOR_MODEL`, `TTS_MODEL`, `TTS_VOICE`, `STT_MODEL`, `REPORT_MODEL` — defaults live in the routes). Tutor behavior is tuned in `STYLE_GUIDE` (`lib/quiz-prompt.ts`); resume design in `PLAN-continue-voice-quiz.md`.

## Daily vote (club pick)

The club can choose the day's article by voting on the home page — per-track, opt-in per day, always for today. The owner opens it with the `wsj-open-vote` skill (senior ballot: top 7 news + top 3 enrichment picks; junior: top 5 news), everyone votes via the ballot modal (one login = one vote, changeable while live), and the owner reads the tally with `wsj-check-vote` (voter names owner-side only). Publishing the winner (with `clubPick: true`) is what closes the poll. No deadline on the site — the owner announces the window in the group chat. Polls/ballots live in Blob under `votes/[junior/]<date>/`, one ballot blob per voter, overwritten in place.

## Daily workflow

1. **Pick** — `wsj-pick-article` (day's news, WSJ + Economist; stops and asks you to log in if either site looks paywalled out) or `wsj-pick-enrichment` (timeless-wisdom read, ≤2,000 words, mostly-free sources; Morgan Housel permanently excluded — owner rule). Junior: `wsj-pick-article-junior`. Pickers only recommend — the user picks.
2. *(vote days)* **`wsj-open-vote`** → the club votes → **`wsj-check-vote`** → the winner feeds step 3 with `clubPick: true`.
3. **Author** — `wsj-reading` (senior) / `wsj-reading-junior` (grades 5–7 calibration, ≤2 concepts). Reads the article in the browser, **proposes vocab + concepts and waits for explicit sign-off**, then: writes the content JSON, captures the self-contained HTML article page + plain article text, uploads the text to Blob, generates pronunciation clips, authors + validates the glossary (+ glossary audio), builds, commits, pushes (= deploys).

Audience calibration and the exact browser-capture snippet live in the skills — the fragile snippet is single-sourced in `wsj-reading/SKILL.md`.

## Deploy & env

GitHub `cosmic-glitch/wsj_club` → Vercel project `wsj_club` (team *Anurag's projects*); **push to `main` = production deploy** at wsjclub.vercel.app. `npm run build` validates all content JSON.

Env (Vercel Production + Preview, mirrored in the gitignored `.env.local`): `OPENAI_API_KEY`, `AUTH_SECRET`, `OWNER_USERS` (= `anurag`), `BLOB_READ_WRITE_TOKEN` (from the linked `wsj-club-quizzes` store), `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`; `SUPABASE_DB_URL` (direct Postgres string) is local/VM-only, for migrations. `AUTH_USERS`/`ADMIN_USERS` are only a transitional login fallback — users live in the repository (`lib/users.ts`). Sensitive values aren't `vercel env pull`-able; recreate `.env.local` by hand on a fresh checkout. Current roster: `anurag` (owner) → arjun, anusha, samaira, mehar; `madan` → puneeth.

## Blob backups

Daily cron on the Hetzner VM (`myhetzner`, repo at `~/wsj_club`): `scripts/backup-blob.sh` at 06:15 → hardlink-incremental snapshots under `backups/<date>/` with a manifest, 30-day retention. VM-only (no off-box copy yet); transient `turns/` clips are deleted after transcription, so their absence from snapshots is normal.

## Commands

- `npm run dev` — local dev at http://localhost:3000
- `npm run build` — production build (validates all content files)
