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
| Grader's audience | **Swap the audience band only.** `buildReportPrompt` hardcodes *"US grade 8–10 students"* and *"a strong grade 8–10 reader"* — those two strings become the junior band. This changes **who** is being graded, not **how strictly** (the anchors and the leniency bump are untouched). See §3, Phase B8. |
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

Introduce `type Track = "senior" | "junior"`. Only the junior track takes a path segment:

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

### The §2 table lists *paths*; the failure sites are *code*. Here is the real checklist.

The table above is the conceptual model. But the feature will actually break at the ~dozen
places that spell the date-keyed paths as **inline string literals** — and several of those
**bypass the existing `session-io.ts` helpers entirely** (they hand-roll `quiz-sessions/${date}/…`
instead of calling `slotJsonPathname` etc.). So the correct first move is:

- **Add ONE `sessionPrefix(track, date)` helper in `lib/session-io.ts`** (`junior/${date}` when
  junior, else `${date}`) and route **every** `quiz-sessions/…` literal through it. Do not
  "add `junior/` when junior" ad hoc at each call site — that is exactly how one gets missed.
- **Make `track` a REQUIRED parameter on `sessionPrefix` and every slot helper** (`slotJsonPathname`,
  `slotAudioPathname`, `readSlot`, `deleteSlot`) — **no `"senior"` default on these.** A default
  here is not a convenience, it's a silent-data-loss trap: a defaulted helper compiles at a junior
  call site while computing the *senior* path, and because the slot flush is best-effort the failure
  is invisible (see the `quiz-audio:50` and `readSlot` cases in Phase B3). Required params turn the
  whole class of "a literal was missed" into **compile errors the TypeScript checker enumerates for
  you** — strictly stronger than grep, and it directly retires this feature's top two risks. Put the
  `"senior"` default **only at the API boundary**, where each route parses `track` out of the request
  once. (The public content loaders `getReading`/`getAllReadings` are the softer tier — a default is
  tolerable there because B5 already audits every call site — but note a defaulted `getReading` is
  *also* silently wrong, returning the senior answer key on a shared date, so if you want the compiler
  to guarantee that too, make them required and accept a larger, mechanical Phase-A diff.)
- Grep is the checklist. As of this writing the literal `quiz-sessions/${date}/` appears in:
  `app/api/quiz-audio/route.ts`, `app/api/quiz-transcribe/route.ts` (as a **regex**, see Phase
  B5), `app/api/quiz-report/route.ts` (×2: `:202`, `:278`), `app/api/quiz-progress/route.ts`
  (×2: `:180`, `:212`), `lib/sessions.ts` (the bare listing prefix — **stays unchanged**, it
  intentionally lists everything), `lib/session-io.ts` (`slotJsonPathname`/`slotAudioPathname`
  **and `deleteSlot`'s own inline prefix at `:154`, which does NOT go through the helpers**), and
  the client `components/VoiceQuiz.tsx` (×3: `:576` slot flush, `:1136` per-turn clip, `:1660`
  final recording). `deleteSlot`'s separate literal is the trap — see Phase B3.

---

## 3. Work breakdown

Three phases. **Phase A** is a pure refactor of the *senior* track with no behavior change —
land and verify it in isolation. **Phase B** builds the entire junior track on top of that
refactor (pages, voice quiz, and Scores support) in one coherent push, because that is where
all the risk lives (the §2 path threading) and a page-only half-step would ship something
nobody uses — the kids' draw is the AI quiz. **Phase C** adds the authoring skill and runs the
pilot.

### Phase A — Extract the shared page components (senior-only, no behavior change)

Today the landing row-list, the handout body, and the self-quiz page body are baked into the
senior route files. Before junior exists, pull each into a shared component taking
`{ readings | reading, track }` (defaulting `track="senior"`), and re-point the existing senior
pages at them. **Nothing about the live site changes** — this is the safety move. Two
copy-pasted handouts would drift within a month; extracting *first*, against the senior track
alone, is what prevents that and de-risks everything after it.

- **The extracted handout must stay a SERVER component.** `audioSrcFor` in
  `app/reading/[date]/page.tsx:32` calls `fs.existsSync` at build time — the shared body cannot
  reflexively become `"use client"`. Keep the `fs` work in the server page and pass the
  resolved audio-src strings down.
- The shared components take `track` now even though only senior calls them — that's the seam
  Phase B plugs junior into.
- **The internal nav hrefs inside these components are date-keyed literals too — same failure
  class as the §2 Blob paths, so grep them the same way.** Two forward-links live *inside* the
  bodies being extracted, both hardcoded `/reading/…`:
  - `app/page.tsx:124` — the index row's **Handout** button: `` href={`/reading/${r.date}`} ``.
  - `app/reading/[date]/page.tsx:110` — the handout's **"Take the self-quiz →" CTA**:
    `` href={`/reading/${reading.date}/quiz`} ``.

  Left literal, a junior handout's self-quiz button sends the kid to the **senior** self-quiz
  (or a 404 when that date has no senior day), and the junior index's Handout button opens the
  **senior** handout. Derive both from `track` (e.g. a `hrefBase = track === "junior" ? "/junior"
  : ""` prefix passed/computed in the shared component). *Not* in this list, deliberately: the
  WEB/PDF links are data-driven (`articleUrl`/`pdfUrl` from the JSON — the junior skill writes the
  `junior/` PDF path), and back-navigation is the SiteHeader monogram (made track-aware in B2), so
  these two hrefs are the whole set.

**Ship this on its own.** It's independently reviewable (the diff is a move + a re-point, no
logic change): verify the senior index, a senior handout, and a senior self-quiz render
identically and `npm run build` still prerenders every senior page, *before* a single junior
file exists.

**Update `CLAUDE.md` in this same PR** (working-agreement hard rule). Phase A is the sharpest
case: `CLAUDE.md` pins the "the `slugify()` here MUST match `scripts/gen-pronunciation.mjs`"
invariant **by path** to `app/reading/[date]/page.tsx` — the very file whose body this phase moves
into a shared component. Left un-updated, Phase A silently invalidates a documented cross-file
contract on day one. Re-point that anchor to the new shared component and note the extraction +
the two track-derived nav hrefs.

### Phase B — The junior track, end to end (pages + voice quiz + Scores)

Everything that makes `/junior` real, landed together.

**B1 — Content loader (`lib/content.ts`).**
- Add `export type Track = "senior" | "junior"` and a `TRACKS` / `contentDirFor(track)` helper.
- `getAllReadings(track: Track = "senior")` and `getReading(date, track: Track = "senior")` —
  senior reads `content/`, junior reads `content/junior/`. Default params mean **no existing
  call site changes**.
- Add `track` to the `Reading` type? **No** — it's implied by the file's location; duplicating
  it in the JSON invites drift. Pass it explicitly where needed.
- **`content/junior/` won't exist until the first junior reading is published.** `getAllReadings`
  already guards its dir with `fs.existsSync(CONTENT_DIR)` and returns `[]`; make sure
  `getAllReadings(track)` inherits that guard for the junior dir, or the build's
  `generateStaticParams` / index will `readdirSync` a missing directory and throw. (This is the
  live reason `/junior` needs the empty state in B2.)

**B2 — The `/junior` pages + navigation.**
- Add `app/junior/page.tsx` (index), `app/junior/reading/[date]/page.tsx` (handout) and
  `app/junior/reading/[date]/quiz/page.tsx` (self-quiz) — thin wrappers rendering the Phase-A
  shared components with `track="junior"`. `generateStaticParams` for each so junior prerenders
  like senior.
- The handout's pronunciation-clip existence check becomes track-aware (`public/audio/junior/…`).
- **Navigation.** Landing (`/`) gets an understated link to `/junior`, and `/junior` one back —
  a mono uppercase link in the topline, in the existing brutalist language.
- **`components/SiteHeader.tsx` — two changes, neither needs a prop** (it's already a client
  component reading `usePathname()`):
  - **Hide rule.** It returns null only when `pathname === "/"`. If `/junior` reuses the landing
    (its own masthead + topline) it'd render *both* the header and the masthead. Change the
    guard to `pathname === "/" || pathname === "/junior"`.
  - **Monogram href.** It always links to `/`; derive it — `pathname.startsWith("/junior") ?
    "/junior" : "/"` — so a junior handout's monogram goes back to `/junior`. A `homeHref`/`track`
    prop is unnecessary machinery given `usePathname` is already in hand.
- **`/junior` empty state** ("No junior readings yet") for the period before the first one.
- **Announcement banner.** `content/announcement.json` is site-wide — show the **same banner on
  both indexes** for now (announcements so far are feature news, which applies to both). Revisit
  if junior-specific guidance is ever needed.

**B3 — Blob path helper + slot primitives (`lib/session-io.ts`).**
- Introduce `sessionPrefix(track, date)` (see the §2 checklist) and have `slotJsonPathname` /
  `slotAudioPathname` / `readSlot` build on it. **`track` is REQUIRED on all of them — no
  `"senior"` default** (see the §2 required-vs-default note). The default lives at the API
  boundary; these internal helpers stay required so the compiler flags every caller.
- **Don't forget `deleteSlot` (`:154`).** It does NOT call the pathname helpers — it hand-rolls
  its own `list({ prefix: \`quiz-sessions/${date}/${safeName}-inprogress\` })`. Left senior-keyed,
  End / Cancel / Start-over on a **junior** attempt lists the senior prefix, finds nothing,
  deletes nothing, and **silently leaves the junior slot behind** — an immortal "Continue" link.
  Route it through `sessionPrefix` too (making `track` required forces this).
- **The `quiz-audio` slot-overwrite allowance is a THIRD, easily-missed site** (`app/api/quiz-audio/route.ts:50`).
  `onBeforeGenerateToken` grants `allowOverwrite: true` for exactly one path via
  `if (pathname === slotAudioPathname(date, safeNameOf(user)))`, immediately followed by
  `if (pathname.includes("-inprogress")) throw`. If `slotAudioPathname` kept a `"senior"` default,
  this call would compile unchanged, compute the **senior** slot path, and a junior pause-time flush
  (`quiz-sessions/junior/<date>/<name>-inprogress.wav`) would miss the equality, fall into the
  reject, and die with "Unexpected upload path" — **silently, since flushing is best-effort**, so a
  junior Save-for-later / failure-pause quietly loses its recording (transcript still survives). The
  required-`track` param (above) turns this into a compile error rather than a grep miss.
- **`readSlot` (the resume probe / load) is the same hazard.** `app/api/quiz-progress` GET calls it
  to detect a saved slot; a defaulted `readSlot` reads the **senior** slot, so a junior "Continue"
  never appears (or surfaces the wrong track's slot). Also covered by making `track` required.
- `components/VoiceQuiz.tsx` **mirrors this pathname convention client-side** (`:576` slot flush,
  `:1136` per-turn clip, `:1660` final recording) — keep the two in lockstep.

**B4 — Article text (`lib/article-text.ts`).** `getArticleText(date, track)` →
`article-text/junior/<date>.txt`.

**B5 — The quiz routes.** Each takes `track` from the request body/query (defaulting to
`"senior"`, so existing clients keep working):
- `app/api/quiz-turn/route.ts` — `getReading(date, track)` for the tutor's answer key.
- `app/api/quiz-report/route.ts` — `getReading(date, track)`; **stamps `track` on the saved
  session record**; hand-rolls two literals (`:202` salvaged-audio copy, `:278` session JSON) →
  `sessionPrefix`.
- `app/api/quiz-progress/route.ts` — `getReading(date, track)`; slot key track-prefixed via the
  helpers; **also hand-rolls two literals** (`:180` audio flush, `:212` archived-slot JSON) →
  `sessionPrefix`; and it writes the slot record, so it must **stamp `track` on the slot** too
  (or the in-progress row shows no `junior` badge and its Continue points at `/`).
- `app/api/quiz-audio/route.ts` — **three changes:** (a) `getReading(date)` at `:40` →
  `getReading(date, track)` — a junior-only date would throw "Unknown reading" and kill *both*
  the per-turn clip uploads and the final recording; (b) the token guard's
  `startsWith('quiz-sessions/<date>/')` → the **track-prefixed** prefix — **do not loosen to a
  bare `quiz-sessions/`** (that's what stops a forged token writing arbitrary paths); (c) the
  **slot-overwrite allowance at `:50`** (`slotAudioPathname(date, safeNameOf(user))`) must pass
  `track` too, or every junior pause-flush silently fails — detailed in B3. **Wrinkle:**
  inside `onBeforeGenerateToken` there is **no request body** — the date comes from
  `clientPayload` (a JSON string the browser passes to `upload()`), so `track` must ride in that
  `clientPayload` at all three client upload sites, not a JSON body.
- `app/api/quiz-transcribe/route.ts` — **already BROKEN for junior, a blocker, not a hardening
  chore.** The guard is a regex, not a `startsWith`: `/\/quiz-sessions\/[^/]+\/turns\//`. A junior
  clip at `quiz-sessions/junior/<date>/turns/…` has **two** segments where `[^/]+` allows one, so
  **every junior answer is rejected** ("Unexpected audio location") and the quiz pauses on answer
  1. Fix: `/\/quiz-sessions\/(junior\/)?[^/]+\/turns\//`. Same "don't loosen to a bare prefix"
  rule — this route both *fetches* and *deletes* the URL it's handed.
- `app/api/quiz-tts/route.ts` — **no change** (text only).
- **`track` is a label, not an identity claim** — safe to take from the client (the page knows
  its track). The slot key's *identity* (`safeName`) must still come from the **cookie**, exactly
  as today. A forged `track` only lets an attacker write to their *own* junior path — no
  cross-user reach. Do not relax the cookie-derived identity.

**B6 — Client (`components/VoiceQuiz.tsx` / `VoiceQuizStep.tsx`).** Accept a `track` prop; pass
it on every API call **and in the upload `clientPayload`** (B5); build the resume deep-link as
`/junior?resume=<date>` on the junior track; read the `?resume=` param on the junior index too.

**B7 — The tutor prompt (`lib/quiz-prompt.ts`).** `buildInstructions` takes an audience
descriptor. The grade is currently **hardcoded in three places**:
- `STYLE_GUIDE`: *"You are talking to a 13–16 year old…"*
- the key-ideas step (article-text variant): *"The bar is a GOOD READING BY A TYPICAL 8TH–10TH
  GRADER…"*
- the key-ideas step (handout-only fallback variant): the same phrasing again.

Parameterize these into an `audience` descriptor (`{ ageRange, gradeBand }`) so junior supplies
**grades 5–7 / 10–13 year olds**. **Nothing else about the tutor changes** — the flow (one
from-memory retelling → all the vocab words → ≥2 concepts → wrap-up) and the coach-the-gaps rule
are already right for both tracks.

One keep-in-sync check: `openingLine()` in `components/VoiceQuiz.tsx` mirrors step 1 of
`buildInstructions` (the fixed, unspoken greeting — a documented lockstep pair). The audience
threading shouldn't touch the opening's wording, but if it does, the client copy must move with it.

**B8 — The grader's audience band (`buildReportPrompt`, same file).** Thread the **same
`audience` descriptor** into the report prompt and use it to replace its two hardcoded grade
strings:
- the setup line: *"The Reading Club gives a small group of **US grade 8–10 students**…"*
- the calibration rule: *"…how much of its real substance **a strong grade 8–10 reader** could
  be expected to cover…"*

**This is the only grading change, and it is deliberately narrow.** It changes **who** the grader
thinks it is reading — not **how strictly** it scores. Everything that sets the strictness is
untouched: the calibration anchors (`lib/grading-examples.ts`), every judging principle, the
1–10 range guidance, and the `applyLeniency` +1 bump (`lib/score.ts`).

*Why do this rather than leave the grader completely alone:* without it, a sharp 11-year-old's
retelling is explicitly scored against **a strong grade 8–10 reader's ceiling** — the grader is
told, in as many words, to expect a high-schooler. That is a mis-framing, not a strictness
setting, and it costs two strings to fix. It is also cheap to revert: if junior scores come out
oddly *high*, put the strings back and nothing else has moved.

*What this does NOT fix:* the anchors are still senior examples drawn from senior articles, so
junior scores will still run low at first (see §4). That is a calibration problem, and it can
only be solved with real junior transcripts — which is exactly why it waits.

*One-line correctness fix while you're in this file:* `buildReportPrompt` calls
`gradingExamplesBlock(reading.date)` (`lib/quiz-prompt.ts:285`), which drops anchors by **date
alone** (`e.sourceDate !== excludeDate`). A junior reading that happens to share a date with a
senior anchor would spuriously drop that anchor. Harmless (it just thins the set), but exclude on
**track+date** instead, and give `GradingExample` a `track` field — you'll want it anyway when
§4's "promote a junior transcript into a junior anchor" happens.

**B9 — Scores page (`/admin`).**
- **`Session` type gains `track?: "junior"`** — *absent means senior*, so **no backfill** of the
  existing session records.
- **Grouping.** `groupByArticle` in `app/admin/page.tsx:26` keys its `Map` on `s.date`, so a
  junior and a senior attempt **on the same date merge into one `ArticleGroup`**, keeping
  whichever title landed first. **This is the one place where a missed change produces silently
  wrong data** (a junior attempt filed under the senior article's title). Fix, narrow and
  mechanical: key the map on **`` `${track}:${date}` ``** and add `track` to `ArticleGroup`.
  **Do NOT resolve the title via `getReading(date, track)` here** — the title is already
  **stamped on each session record** (`s.title`, written by `quiz-report`); `groupByArticle`
  never reads content, and a `getReading` call on this `force-dynamic` page re-reads and
  re-parses *every* content file.
- **Badge.** `components/AdminSessions.tsx` shows a **`junior` badge** (alongside the existing
  `partial` / `cancelled` / `in progress` badges) — so a teacher never compares an 8/10 junior
  score against an 8/10 senior score without noticing.
- **Links — THREE, not two**, all in `AdminSessions.tsx`, all carrying the track prefix: the
  row's article link (`:195`), the in-progress row's **Continue** link (`:262` →
  `/junior?resume=<date>`), and the **article link inside the Details modal** (`:345` — easy to
  miss, it's a second copy).
- Everything else — classroom scoping, owner tabs, delete, the Details modal body — is
  **track-agnostic**. (The delete route guards on the bare `/quiz-sessions/` prefix, which covers
  junior paths too.)

**Update `CLAUDE.md` in this same PR** (working-agreement hard rule): Phase B changes documented
architecture and file layout — the new `Track` type + `content/junior/` and `quiz-sessions/junior/`
conventions, the `/junior` routes, the `track` field stamped on session records, the `sessionPrefix`
helper, and the `junior` badge on Scores. Fold these into the architecture / content-schema /
voice-quiz sections rather than leaving the doc describing a senior-only world.

### Phase C — The `wsj-reading-junior` skill + pilot

#### The `wsj-reading-junior` skill

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

- `scripts/gen-pronunciation.mjs` → simplest is a **`--track` flag that repoints the `CONTENT` and
  `AUDIO` bases up front**, because the track affects **three** senior-hardcoded spots, not just
  one: `daysToProcess()`'s **`all` sweep** (`:46`, `readdirSync(CONTENT)` — enumerates only the
  senior dir), the per-day **`readFileSync(path.join(CONTENT, ...))`** (`:88`), and the
  **`outDir = path.join(AUDIO, date)`** write. Repointing the two bases makes `all` naturally sweep
  whichever track's dir and needs no other change: read from `content/junior/<date>.json`, write to
  `public/audio/junior/<date>/`.
- `scripts/upload-article-text.mjs` → uploads to `article-text/junior/<date>.txt`.

#### Pilot + verify

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

**Update `CLAUDE.md` alongside the skill** (working-agreement hard rule): document the new
`wsj-reading-junior` skill in the daily-workflow section and the two scripts' `--track` argument,
mirroring how the senior skill/scripts are described.

---

## 4. Deliberately not doing (yet)

- **No junior grading calibration.** Beyond the audience-band swap (Phase B8), the grader is
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
| A date-keyed path is missed and a junior day silently overwrites a senior artifact | The Phase-C same-date collision test is designed to catch exactly this; the **grep checklist under §2** (not just the path table) is what to work through — several sites bypass the `session-io` helpers |
| A track-sensitive slot helper keeps a `"senior"` default → a junior call compiles but computes the senior path, and (flush being best-effort) fails **silently** — losing a junior recording (`quiz-audio:50`), hiding a junior Continue (`readSlot`), or orphaning a junior slot (`deleteSlot`) | **Make `track` a required parameter** on `sessionPrefix` + every slot helper (§2 / Phase B3), default only at the API boundary — the compiler then enumerates every call site instead of relying on grep |
| A hand-rolled literal is missed — esp. `deleteSlot`'s own prefix (`session-io.ts:154`) — leaving an un-deletable junior in-progress slot (immortal Continue) | Route every `quiz-sessions/…` literal through the new `sessionPrefix(track, date)` helper (Phase B3); the required-`track` param + the grep list are the checklist |
| `quiz-transcribe`'s `[^/]+` regex rejects every junior answer clip → the quiz pauses on answer 1 | Already-broken blocker, fixed in Phase B5 (`(junior\/)?` in the regex) — verify a junior answer transcribes on the preview deploy |
| The `/admin` grouping keys on date alone and merges a junior + senior attempt into one row under the wrong title | Called out explicitly in Phase B9 — key the map on `(track, date)`; the title is already stamped on the record, so no `getReading` needed |
| Handout/index components get copy-pasted per track and drift | Phase A extracts shared components *first*, before the junior pages exist |
| A date-keyed nav href *inside* a shared component stays literal → a junior handout's self-quiz CTA / the junior index's Handout button link into the senior track (or a 404) | Named in Phase A: the two sites are `app/page.tsx:124` and `app/reading/[date]/page.tsx:110`; derive both from `track` |
| WSJ prose is simply too hard for grade 5 regardless of the handout | This is the track's fundamental constraint. The pilot is the test; if it fails, the fallback is a different source (Smithsonian / Nat Geo), which is a bigger change and out of scope here |
| Junior scores discourage kids because the grader is senior-calibrated | Known and accepted for now; see §4. The `junior` badge at least stops the *teacher* misreading them |
