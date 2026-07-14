# Plan: the Junior track (`/junior`)

A second reading track for younger kids (**US grades 5–7**), living at `/junior`, with its
own occasional list of articles, its own handouts, its own self-quizzes and its own AI
voice quizzes — but sharing the **same site, the same logins, the same classrooms and the
same Scores page** as the main (senior, grades 8–10) club.

Status: **planned, not built.** No code has been written.

---

## 1. Decisions already made

| Question | Decision |
| --- | --- |
| Audience | **US grades 5–7** ("kids are sharp" — this is not a remedial track) |
| URL / name | **`/junior`** (singular), not `/juniors` |
| Where the articles come from | **Human-picked only.** No changes to `wsj-pick-article`; no new picking skill. The user supplies a link. |
| How a day is authored | A **new sibling skill, `wsj-reading-junior`** — a copy of `wsj-reading` recalibrated for grades 5–7, publishing into the junior track. Same handout format (vocab / concepts / 5-question self-quiz). |
| Grading | **Unchanged in strictness.** Same grader, same calibration anchors (`lib/grading-examples.ts`), same +1 leniency bump (`lib/score.ts`). Revisit once real junior transcripts exist. |
| Grader's audience | **Swap the audience band only.** `buildReportPrompt` hardcodes *"US grade 8–10 students"* and *"a strong grade 8–10 reader"* — those two strings become the junior band. This changes **who** is being graded, not **how strictly** (the anchors and the leniency bump are untouched). See §3, Phase 2.6. |
| Identity | **Shared.** Same teacher/student logins and classrooms; no `level` field on the user record for now. Nothing is gated by track — any logged-in student can open either track. |
| Sessions | Junior quiz sessions carry a **`track` field** and show a **badge** on the Scores page, so the two scales are never silently compared. |
| Cadence | Occasional (not daily). A junior day is **additive** — it does not replace that day's senior reading. |

---

## 2. The central technical problem: `date` is no longer a unique key

Today, one date = one article, and **every path in the system is keyed on the date alone**:

| Thing | Key today |
| --- | --- |
| Content file | `content/<date>.json` |
| Served PDF | `public/pdfs/<date>.pdf` |
| Pronunciation clips | `public/audio/<date>/<slug>.mp3` |
| Full article text (Blob) | `article-text/<date>.txt` |
| Saved quiz sessions (Blob) | `quiz-sessions/<date>/<user>-<ts>.json` (+ `.wav`) |
| Per-turn answer clips (Blob) | `quiz-sessions/<date>/turns/…` |
| In-progress slot (Blob) | `quiz-sessions/<date>/<user>-inprogress.json` / `.wav` |
| Resume deep-link | `/?resume=<date>` |

The senior track publishes **daily**; the junior track publishes **occasionally**. So a junior
article will almost always land on a date that **already has a senior article**. Collision is
the *default case*, not an edge case. Left unaddressed, a junior day would overwrite the
senior day's PDF, its pronunciation clips and its article text — and, worse, a student's
junior quiz session and in-progress slot would collide with their senior ones for the same
date.

### The fix: `track` is a first-class dimension, and senior keeps today's paths

Introduce `type Track = "senior" | "junior"`, **defaulting to `"senior"` everywhere**. Only the
junior track takes a path segment:

| Thing | Senior (unchanged) | Junior (new) |
| --- | --- | --- |
| Content file | `content/<date>.json` | `content/junior/<date>.json` |
| Served PDF | `public/pdfs/<date>.pdf` | `public/pdfs/junior/<date>.pdf` |
| Pronunciation clips | `public/audio/<date>/` | `public/audio/junior/<date>/` |
| Article text (Blob) | `article-text/<date>.txt` | `article-text/junior/<date>.txt` |
| Sessions + slot (Blob) | `quiz-sessions/<date>/…` | `quiz-sessions/junior/<date>/…` |
| Index | `/` | `/junior` |
| Handout | `/reading/<date>` | `/junior/reading/<date>` |
| Self-quiz | `/reading/<date>/quiz` | `/junior/reading/<date>/quiz` |
| Resume deep-link | `/?resume=<date>` | `/junior?resume=<date>` |

**Consequences of this choice, all of them good:**

- **Zero backfill.** All ~33 existing content files, PDFs, audio directories and saved
  sessions stay exactly where they are. No migration, no rewritten Blob keys, no risk to
  existing data.
- **Zero change to existing URLs.** Every bookmark and every link on the live site still works.
- Junior is **purely additive** — if the junior track were deleted tomorrow, nothing senior
  would notice.
- `content/junior/` is a *directory* inside `content/`, and `getAllReadings()` filters with
  `/^\d{4}-\d{2}-\d{2}\.json$/`, so the existing loader **already ignores it**. No accidental
  cross-contamination of the senior list.
- `loadSessions()` lists the prefix `quiz-sessions/`, so junior sessions under
  `quiz-sessions/junior/…` are **still picked up by the existing listing** with no change —
  they just need to be *labelled*, which the `track` field on each record does.

**The real work in this feature is threading `track` through the quiz API routes**, not
building the page. Four of the five quiz routes load a day's content by date alone
(`getReading(date)`) and would otherwise hand the tutor **the wrong article's answer key**.

---

## 3. Work breakdown

### Phase 1 — Track plumbing + the `/junior` pages (no voice quiz yet)

Ships a browsable junior track with handouts and self-quizzes. Independently useful; can be
deployed and used before Phase 2 exists.

1. **`lib/content.ts`**
   - Add `export type Track = "senior" | "junior"` and a `TRACKS` / `contentDirFor(track)` helper.
   - `getAllReadings(track: Track = "senior")` and `getReading(date, track: Track = "senior")`
     — senior reads `content/`, junior reads `content/junior/`. Default params mean **no
     existing call site changes**.
   - Add `track` to the `Reading` type? **No** — the track is implied by the file's location,
     and duplicating it in the JSON invites drift. Pass it explicitly where needed.
2. **Route group.** Add `app/junior/page.tsx` (index), `app/junior/reading/[date]/page.tsx`
   (handout) and `app/junior/reading/[date]/quiz/page.tsx` (self-quiz).
   - **Extract, don't copy.** The landing row-list, the handout body and the self-quiz page
     bodies move into shared components taking `{ readings | reading, track }`. Two
     copy-pasted handouts would drift within a month. This refactor is the bulk of Phase 1.
   - `generateStaticParams` for the junior routes so junior pages prerender like senior ones.
   - The pronunciation-clip existence check in the handout (`fs.existsSync(public/audio/…)`)
     becomes track-aware.
3. **Navigation.**
   - Landing (`/`) gets a link to `/junior`; `/junior` gets a link back to `/`. Keep it
     understated — a mono uppercase link in the topline, in the existing brutalist language.
   - `components/SiteHeader.tsx`: the "RC" monogram currently always links to `/`. It must
     link to the **current track's index** — from a junior handout, back to `/junior`. Add a
     `homeHref` (or `track`) prop.
   - `/junior` needs an **empty state** ("No junior readings yet") for the period before the
     first one is published.
4. **Announcement banner.** `content/announcement.json` is site-wide. For now, show the
   **same banner on both indexes** (simplest, and announcements so far have been feature
   news, which applies to both). Revisit if junior-specific guidance is ever needed.

### Phase 2 — The voice quiz on the junior track

The `track` dimension has to reach every route that resolves a day's content or writes to a
date-keyed Blob path.

1. **`lib/session-io.ts`** — `slotJsonPathname(date, safeName)` / `slotAudioPathname(…)` take
   a `track` and prefix `junior/` when junior. `readSlot`'s `list({ prefix })` follows.
   `components/VoiceQuiz.tsx` **mirrors this pathname convention client-side** (it builds the
   slot WAV path for its flush) — the two must stay in lockstep, and the mirroring is already
   flagged in a comment there.
2. **`lib/article-text.ts`** — `getArticleText(date, track)` → `article-text/junior/<date>.txt`.
3. **The routes.** Each takes `track` from the request body/query (defaulting to `"senior"`,
   so existing clients keep working):
   - `app/api/quiz-turn/route.ts` — `getReading(date, track)` for the tutor's answer key.
   - `app/api/quiz-report/route.ts` — `getReading(date, track)`; writes the session JSON + the
     salvaged audio under the track-prefixed `quiz-sessions/` path; **stamps `track` on the
     saved session record**.
   - `app/api/quiz-progress/route.ts` — `getReading(date, track)`; the slot's key is
     track-prefixed (this is what stops a junior slot colliding with the same student's senior
     slot on the same date).
   - `app/api/quiz-audio/route.ts` — the upload-token guard currently asserts
     `pathname.startsWith('quiz-sessions/<date>/')`. It must assert the **track-prefixed**
     prefix, or a junior upload is rejected. **Do not loosen this check to a bare
     `quiz-sessions/` prefix** — it is what stops a forged token minting writes to arbitrary
     session paths.
   - `app/api/quiz-transcribe/route.ts` — same: its allowed `turns/` prefix becomes
     track-aware.
   - `app/api/quiz-tts/route.ts` — **no change** (it only takes text).
   - **`track` is a label, not an identity claim** — it is safe to take from the client (the
     page knows which track it is). The *identity* on the slot key must still come from the
     **cookie**, exactly as today. Do not relax that.
4. **`components/VoiceQuiz.tsx` / `VoiceQuizStep.tsx`** — accept a `track` prop; pass it on
   every API call; build the resume deep-link as `/junior?resume=<date>` on the junior track;
   read the `?resume=` param on the junior index too.
5. **The tutor prompt (`lib/quiz-prompt.ts`).** `buildInstructions` takes the audience band.
   The grade is currently **hardcoded in three places** in the tutor prompt:
   - `STYLE_GUIDE`: *"You are talking to a 13–16 year old…"*
   - the key-ideas step (article-text variant): *"The bar is a GOOD READING BY A TYPICAL
     8TH–10TH GRADER…"*
   - the key-ideas step (handout-only fallback variant): the same phrasing again.

   Parameterize these into an `audience` descriptor (`{ ageRange, gradeBand }`) so the junior
   track supplies **grades 5–7 / 10–13 year olds**. **Nothing else about the tutor changes** —
   the flow (one from-memory retelling → all the vocab words → ≥2 concepts → wrap-up) and the
   coach-the-gaps rule are already right for both tracks.
6. **The grader's audience band (`buildReportPrompt`, same file).** Thread the **same
   `audience` descriptor** into the report prompt and use it to replace its two hardcoded
   grade strings:
   - the setup line: *"The Reading Club gives a small group of **US grade 8–10 students**…"*
   - the calibration rule: *"…how much of its real substance **a strong grade 8–10 reader**
     could be expected to cover…"*

   **This is the only grading change, and it is deliberately narrow.** It changes **who** the
   grader thinks it is reading — not **how strictly** it scores. Everything that sets the
   strictness is untouched: the calibration anchors (`lib/grading-examples.ts`), every judging
   principle, the 1–10 range guidance, and the `applyLeniency` +1 bump (`lib/score.ts`).

   *Why do this rather than leave the grader completely alone:* without it, a sharp 11-year-old's
   retelling is explicitly scored against **a strong grade 8–10 reader's ceiling** — the grader is
   told, in as many words, to expect a high-schooler. That is a mis-framing, not a strictness
   setting, and it costs two strings to fix. It is also cheap to revert: if junior scores come
   out oddly *high*, put the strings back and nothing else has moved.

   *What this does NOT fix:* the anchors are still senior examples drawn from senior articles, so
   junior scores will still run low at first (see §4). That is a calibration problem, and it can
   only be solved with real junior transcripts — which is exactly why it waits.

### Phase 3 — Scores page (`/admin`)

1. **`Session` type gains `track?: "junior"`** — *absent means senior*, so **no backfill** of
   the existing session records.
2. **Grouping.** `app/admin/page.tsx` groups sessions by article using the date. With two
   tracks a date can now name **two different articles**, so grouping must key on
   **`(track, date)`** and resolve the title via `getReading(date, track)`. **This is the one
   place where a missed change produces silently wrong data** (a junior attempt filed under the
   senior article's title) — get it right in review.
3. **Badge.** `components/AdminSessions.tsx` shows a **`junior` badge** on junior attempts
   (alongside the existing `partial` / `cancelled` / `in progress` badges) — so a teacher
   never compares an 8/10 junior score against an 8/10 senior score without noticing.
4. **Continue link.** The in-progress row's Continue link must point at the right track's
   index (`/junior?resume=<date>`).
5. Article links in the table point at the right track's handout.
6. Everything else — classroom scoping, owner tabs, delete, the Details modal — is
   **track-agnostic and needs no change**.

### Phase 4 — The `wsj-reading-junior` skill

A copy of `.claude/skills/wsj-reading/SKILL.md` with:

- **Audience calibration → US grades 5–7.** Simpler vocabulary (still real words worth
  learning — this is a sharp cohort, not a remedial one); concepts that stay **concrete**
  (a 5th grader can't lean on abstraction, so the Feynman "vivid hook → how it works →
  concrete example" rule matters *more* here, not less); the same 5-question self-quiz.
- **Output paths:** `content/junior/<date>.json`, `public/pdfs/junior/<date>.pdf`,
  `public/audio/junior/<date>/`, `article-text/junior/<date>.txt`.
- The same manual quality gate: **propose the vocab + concepts and wait for explicit
  go-ahead** before generating.
- **No article-picking step** — the user supplies the link (`wsj-pick-article` is untouched).

Two scripts take a track argument (defaulting to senior):

- `scripts/gen-pronunciation.mjs` → writes to `public/audio/junior/<date>/`.
- `scripts/upload-article-text.mjs` → uploads to `article-text/junior/<date>.txt`.

### Phase 5 — Pilot + verify

Publish **one** junior reading and walk the whole thing end to end.

**The England–Argentina World Cup piece is the natural pilot**
(`wsj.com/sports/soccer/england-argentina-world-cup-maradona`): it's a story with characters, a
cheat goal, a rivalry and a war behind it — narrative, high-engagement, low prerequisite
knowledge. Its weakness as a *senior* pick (anecdote-heavy, idea-light) is exactly its strength
here. Caveat: the **prose is grade 10–11 even though the story isn't** — which is the honest,
permanent constraint of this whole track (WSJ has no easier tier), and the pilot is precisely
how we find out whether the handout can carry a sharp 6th grader through it.

Verify, on a preview deploy and on a real phone:

- Junior + senior article **on the same date** — confirm no PDF / audio / article-text /
  session / slot collision. **This is the whole point of the track prefix; test it explicitly.**
- The same student has an in-progress attempt on **both tracks on the same date** — two
  distinct slots, two distinct Continue links, neither stomps the other.
- The junior tutor addresses the student as a 5th–7th grader, and quizzes **all** the junior
  vocab words and ≥2 junior concepts.
- The Scores page shows the junior attempt with its badge, under the **junior** article title.

---

## 4. Deliberately not doing (yet)

- **No junior grading calibration.** Beyond the audience-band swap (Phase 2.6), the grader is
  untouched: the anchors in `lib/grading-examples.ts`, every judging principle, and the
  `applyLeniency` +1 bump all stay as they are. **Expect junior scores to read low at first** —
  the anchors are senior examples that reward reaching an article's subtler ideas, which is not
  what a 6th grader should be optimizing for, and swapping the audience strings does not change
  that. Don't react to the first two or three. Once a handful of real junior transcripts exist,
  promote a couple into junior-specific anchors; the `track` field on each session is what lets
  us find them.
- **No `level` field on the user record.** Nothing is gated by track; a junior can open a
  senior handout and vice versa. With a club this small, gating is over-engineering.
- **No junior article-picking skill.** Human-picked links only.
- **No per-track announcement banner.**

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| A date-keyed path is missed and a junior day silently overwrites a senior artifact | The Phase-5 same-date collision test is designed to catch exactly this; the table in §2 is the checklist |
| The `/admin` grouping keys on date alone and files a junior attempt under the senior article | Called out explicitly in Phase 3.2 — key on `(track, date)` |
| Handout/index components get copy-pasted per track and drift | Phase 1.2 extracts shared components *first*, before the junior pages exist |
| WSJ prose is simply too hard for grade 5 regardless of the handout | This is the track's fundamental constraint. The pilot is the test; if it fails, the fallback is a different source (Smithsonian / Nat Geo), which is a bigger change and out of scope here |
| Junior scores discourage kids because the grader is senior-calibrated | Known and accepted for now; see §4. The `junior` badge at least stops the *teacher* misreading them |
