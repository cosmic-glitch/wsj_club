# Plan — Continuable voice-quiz sessions (pause & resume) · v2

> **Status:** Design approved by the product owner; **not yet implemented.** v2 (2026-07-07) is a full
> rewrite after a code review of the v1 draft: the home-launcher UX changed (see Decision 1), and the
> review's findings are folded in as design requirements (each marked **[fix]** where it changed v1).
> Companion to the *Voice quiz* section of `CLAUDE.md` (esp. *Strict End gating*, *Partial attempts*,
> *Cancelled attempts*). Code sketches are illustrative pseudo-diffs against the real
> `components/VoiceQuiz.tsx`, `app/api/quiz-report/route.ts`, `components/AdminSessions.tsx`,
> `app/admin/page.tsx`, and `lib/sessions.ts` — **verify against the real files; don't paste blindly.**

## Why

Student feedback (Arjun, after the 2026-07-06 quizzes):

> "Make it so if you leave the page instead of finalizing it saves your response and next time you click
> voice quiz it continues. It should only cancel if you press cancel and only finalize if you press
> finalize. Also add confirmations to cancel/finalize."

Today, **leaving the page mid-quiz loses everything** — the unmount cleanup in `VoiceQuiz.tsx` only aborts
fetches and releases the mic; it never saves. And a transcription/tutor **failure auto-finalizes** a graded
*partial* with no button press (`failAndEnd`). Arjun wants the opposite: leaving/failing should **pause**
(not lose, not finalize, not cancel), and a paused attempt should be **continuable from the UI**.

## Decisions (product owner)

1. **The home launcher always reads "Voice quiz" — never "Continue quiz."** When the student clicks it
   and a saved in-progress attempt exists for that day, the modal opens with a **chooser** — **Continue
   saved quiz** / **Start over** — instead of silently starting fresh or silently resuming. (Changed from
   v1, which relabeled the launcher "Continue quiz" and resumed on click; the owner wants the label stable
   and the choice explicit.) No slot → the click starts fresh exactly as today. Logged-out behavior is
   unchanged (login prompt on click).
2. **Continue also lives on the Scores page:** a student's own in-progress entry shows a **Continue**
   button that resumes directly (no chooser — the button is already the explicit choice).
3. **In-progress = no score.** A paused attempt shows in Scores as **"In progress"** with **no grade**.
   It's graded **only** when finished with **End**. (This changes today's behavior, where a failure-ended
   partial gets a real score.)
4. **Only buttons are terminal.** Failures / hangs / leaving all keep a **continuable** in-progress record.
   A session is graded-and-completed **only on End**, and ended-for-good **only on Cancel** (Cancel does NOT
   throw the work away — it still saves an ungraded, teacher-only `cancelled` record; it just doesn't count
   and isn't continuable). Nothing auto-finalizes or auto-cancels. **No stale cleanup** — in-progress
   records persist until the student finishes, cancels, or starts over (or the teacher deletes them).
5. **No End confirmation.** End is already gated to the true end (strict End-gating, shipped 2026-06-29):
   it only appears once the tutor signals `done`, so a confirm there is pure friction. **Cancel keeps its
   confirm** — it's the one exit that ends the attempt *for good* (no Continue); the confirm is reworded to
   distinguish "end it" from "leave and continue later."
6. **Audio is best-effort ("text-first").** Transcript + grade always resume whole. The recording for an
   interrupted-then-resumed session may have gaps; full cross-resume audio stitching is deferred (Phase 2).
   **[fix]** Within that: whenever a pause happens *with the page still alive* (a failure pause, or the
   explicit "Leave — continue later" button), the audio captured so far IS flushed to the slot best-effort —
   so a failure the student never returns to still leaves the teacher a recording, as it does today.

## The model: existing vs. new

| Exit | Today | New |
|---|---|---|
| **End** (shown only when tutor `done`) | grade + save complete (`partial:false` + report) | unchanged; also **deletes the in-progress slot** |
| **Cancel** | save ungraded `cancelled` (teacher-only) | unchanged, reworded confirm; also **deletes the slot** |
| **Start over** (new, from the launcher chooser) | n/a | **archives the old slot as a `cancelled` record** (teacher-only, ungraded — never silently discarded), deletes the slot, starts fresh |
| **Leave / reload / modal close / iOS tab-kill** | **silent total loss** | **checkpointed in-progress record** → continuable |
| **Failure / hang** | `failAndEnd` → graded **partial**, ends | session stays live in a **recoverable pause** — "Try again" / "Leave — continue later"; **no auto-grade, no terminal end**; audio flushed best-effort |
| **`MAX_TURNS` runaway** | auto-saves graded partial, ends | **[fix]** backstop **sets `tutorDone = true`** (checkpointed) + shows "This quiz ran long — press End quiz to finish and get your grade." So **End appears** and the attempt is finishable/gradable. (v1 paused it, which made a runaway *permanently* unfinishable: resuming a transcript already at `MAX_TURNS` re-trips the backstop forever, End never appears, and nothing grades — the work would be stuck ungraded with Cancel as the only exit.) |

**Why terminal actions delete the slot:** the slot's existence is literally what shows Continue (Scores)
and the chooser (launcher). If End/Cancel/Start-over left it behind, the student would see a stale
"Continue" for an attempt that's already graded or ended — two live records for one attempt. The delete is
best-effort/idempotent (a very early Cancel has no slot to remove), but **ordered after a successful final
save**: if the final save fails, the slot is kept, so the student can still Continue rather than losing the
attempt to a storage hiccup. **[fix — ordering was unspecified in v1.]**

## Session states — an explicit `inProgress` flag

The slot record carries an explicit **`inProgress: true`** field; Continue / "In progress" rendering keys
off that (plus, belt-and-braces, the `-inprogress.json` pathname, which `loadSessions` already attaches as
`blobUrl`).

**[fix]** v1 inferred "in progress" from `partial && report == null` with "no migration needed." That
inference is wrong: grading in `app/api/quiz-report/route.ts` is **best-effort** — if the OpenAI call
fails/errors (or the key is unset), a *legacy* session saves with `report: null` (see the `let report =
null` flow). Such a record would have rendered as "In progress" + Continue with no slot behind it — a
Continue that 404s. The explicit flag costs one field and removes the ambiguity entirely.

| Record | Means | Scores shows |
|---|---|---|
| `inProgress: true` (the slot; always `partial:true, report:null, cancelled:false`) | paused or actively mid-quiz | **"In progress"** + **Continue** (owner only; teacher sees it informational + deletable) |
| `partial && !inProgress` | **legacy** failure-partial (graded, or `report:null` if its grading failed) | exactly as today (partial badge, score or "—", **no** Continue) |
| `cancelled` | ended via Cancel **or superseded by Start over** | today's grey badge, teacher-only |
| neither | complete | the grade |

No status enum, no migration; legacy records render exactly as they do today.

## Storage

**"The in-progress slot"** is the single Blob record holding a paused/live attempt. At most one per
(student, date).

- **Stable JSON key, overwritten on each checkpoint:** `quiz-sessions/<date>/<safeName>-inprogress.json`
  (`put(..., { addRandomSuffix: false })`). Completed/cancelled records keep today's random-suffixed
  `…-<Date.now()>.json`.
- **Stable audio key** for the best-effort pause flush: `quiz-sessions/<date>/<safeName>-inprogress.wav`,
  also overwritten in place (so repeated pauses don't pile up orphan blobs). Deleted together with the JSON
  slot on End/Cancel/Start-over (Phase 1 doesn't merge it — see *Audio semantics*).
- **[fix] `safeName` derives from the COOKIE user, never the request body.** Today's `quiz-report` derives
  `safeName` from the client-sent `studentName` — harmless for random-suffixed writes, but for a **stable,
  overwritable** key a malicious body could stomp another student's slot. `POST /api/quiz-progress` ignores
  any client-sent name for the key ( `safeName(currentUser())` ), and `quiz-report`'s slot-*delete* computes
  the same cookie-derived key so it matches what the checkpoint wrote. (The completed record's filename can
  keep today's convention for compatibility.)
- **[fix] Reads of the slot MUST cache-bust with `uploadedAt`.** The slot is overwritten in place many
  times per quiz, and this project has already been burned by exactly this: a public Blob URL is CDN-edge-
  cached, and a plain `no-store` fetch can return a **stale copy right after an overwrite** — `lib/users.ts`
  had to key every read with `?v=<uploadedAt>` from `list()` metadata (which IS read-after-write
  consistent). Without the same here, a student who leaves and quickly clicks Continue can resume from a
  checkpoint **missing their last answers** — silent data loss inside the feature built to prevent it. So
  the resume `GET` does `list({ prefix: "quiz-sessions/<date>/" })`, finds the slot by pathname, and fetches
  `${blob.url}?v=${blob.uploadedAt.getTime()}`. `lib/sessions.ts` gets the same one-line treatment for all
  session reads (cheap, and it makes the Scores view of a live attempt current too). The slot's `audioUrl`
  is stored **with a `?v=<flush-time>` suffix baked in at flush time** so the teacher's player doesn't
  fetch a stale overwrite.
- **teacherId** is stamped on the slot (same `getUser(user).teacherId` lookup as `quiz-report`), so Scores
  scoping works while it's in progress.
- **Slot record shape:** `{ date, title, studentName, loginUser, teacherId, inProgress: true, partial:
  true, cancelled: false, report: null, transcript, tutorDone, resumeCount, audioUrl?, durationMs?,
  updatedAt, diag: { sessionId, mountId, breadcrumbs } }`.

## New / changed surfaces

### 1. `POST /api/quiz-progress` (new, login-gated) — checkpoint

Upserts the slot. **Never grades, never calls the model.** Body: `{ date, transcript, tutorDone,
resumeCount, audioUrl?, durationMs?, sessionId, mountId, breadcrumbs }`. Validates `date` against
`getReading` (no junk prefixes); sanitizes/caps every field like `quiz-report` does (factor the shared
sanitizers out — e.g. a small `lib/session-io.ts`). Identity (slot key, `loginUser`, `studentName`,
`teacherId`) comes **entirely from the cookie user**. Returns `{ ok: true }`.

### 2. `GET /api/quiz-progress?date=` (new, login-gated) — load for resume + chooser probe

Returns **the caller's own slot only** (`404`/`{ exists:false }` if none) — the key is derived from the
cookie user; there is no way to request another user's slot. **[fix — v1 left this implicit; transcripts
are deliberately teacher-only, so a student must never be able to read a classmate's in-progress
transcript by guessing a date.]** Read is `uploadedAt`-cache-busted as above. Response: the full slot
JSON (transcript, `tutorDone`, `resumeCount`, `sessionId`, `updatedAt`). The launcher also calls this on
click just to decide fresh-vs-chooser (the same response then feeds the resume, so it's one call, not two).

### 3. `DELETE /api/quiz-progress?date=` (new, login-gated) — Start over

Archives-then-deletes the caller's own slot: writes its content as a normal random-suffixed **`cancelled`**
record (ungraded, teacher-only, `failure: { reason: "superseded", detail: "student chose Start over" }`),
then `del()`s the slot JSON + slot audio. Nothing a student did is ever silently thrown away — same
philosophy that made Cancel save. Idempotent if the slot is already gone.

### 4. `components/VoiceQuiz.tsx` — checkpoint + resume + pause re-model

- **Checkpoint** after every transcribed answer and every tutor turn: `void checkpoint()` → POST
  `/api/quiz-progress` with `transcriptRef.current` + `tutorDone` + `resumeCount` (fenced by `runId` via
  `canContinue(runId)` so a stale run can't overwrite a newer slot). **[fix] Track the in-flight checkpoint
  promise in a ref (`checkpointInFlightRef`), and make `finalizeQuiz` AWAIT its settlement (with a short
  timeout, ~5s) before the final save + slot delete.** Client-side fencing alone can't stop a request that
  has already left the browser: a fire-and-forget checkpoint sent just before End could land at the server
  *after* the slot delete, resurrecting a stale "Continue" for a finished quiz — and resuming that would
  produce a second record for one attempt (the exact double-save class the diagnostics tripwire watches
  for). Once `endingRef` is set, no new checkpoints fire; awaiting the one in flight closes the race.
- **Launcher chooser** (in `launch()`, after the login gate): GET the slot. Exists → show **"You have a
  quiz in progress for this article. Continue where you left off, or start over?"** with **Continue** /
  **Start over** (+ close). Continue → `resume(slot)`. Start over → confirm briefly, `DELETE
  /api/quiz-progress?date=`, then the normal fresh `start()`. No slot → straight to `start()` as today.
- **`resume(session)`** (new, parallel to `start()`): set `transcriptRef` from the slot, render the log,
  re-acquire the mic (the click is the user gesture), bump `activeRunIdRef`, **reuse the saved `sessionId`**
  (slot key + diagnostics stay linked across the pause), increment `resumeCount`, reset
  `endStartedRef`/`endingRef`, restore `tutorDone`. Then continue the loop: last turn is a **student**
  answer → `nextTutorTurn(...)`; last turn is a **tutor** question → phase `tutorTurn` (student presses
  Start speaking); `tutorDone` → show **End** immediately. **Skip the fixed-opening fast-path** (fresh-start
  only). Segments start empty (Phase 1: audio from the resume onward).
- **`failAndEnd` → `pauseOnFailure`:** a transcription/tutor failure or hang **no longer** calls
  `finalizeQuiz`. Instead: stop the loop, keep the checkpoint, **best-effort flush the audio-so-far**
  (stitch current segments via `buildTeacherFile`, upload through the existing `/api/quiz-audio` token flow
  to the stable slot-WAV key, checkpoint with `audioUrl` + `durationMs`) — the page is alive at this
  moment, so this is cheap and preserves today's guarantee that a failed attempt leaves the teacher a
  recording **[fix — v1's Phase 1 lost all audio for a never-resumed failure]** — and show a recoverable
  state: *"Couldn't reach the tutor. [Try again] [Leave — continue later]"*. "Try again" re-runs the failed
  leg from client-held state; "Leave" closes the modal without finalizing. Cancel stays available.
- **`MAX_TURNS` runaway:** set `tutorDone = true`, checkpoint, show the ran-long notice (not spoken). End
  appears through the normal gate — the strict-End invariant (*End only at `tutorTurn && tutorDone`*) is
  preserved, so the `end:called`-at-wrong-phase diagnostic tripwire stays meaningful.
- **Unmount / `pagehide` / `visibilitychange→hidden` / modal close mid-quiz:** do **not** finalize and do
  **not** cancel — this is a **leave** (the per-answer checkpoint is already saved; a hard tab-kill loses at
  most the last in-flight turn). Release the mic as today. No large async work on unload (unreliable,
  which is exactly why checkpointing is per-answer).
- **`finalizeQuiz`** is now reached **only** by `userEnd()` (gate unchanged: `tutorTurn && tutorDone`) and
  `cancel()`. The once-guard + run-fencing stay.
- **Cancel reword** (`confirmCancel`): *"Cancel this quiz? It won't count and you won't be able to continue
  it later. (To keep it for later, just leave — you can resume from your Scores page or by clicking Voice
  quiz again.)"*
- **`/?resume=<date>` auto-open:** on mount, read `window.location.search` (not `useSearchParams`, which
  would force a Suspense boundary into the static home page); if it names this day's date and the user is
  logged in, auto-launch straight into `resume()` (skipping the chooser — Scores' Continue was the explicit
  choice). Logged out → the usual login prompt.

### 5. `components/AdminSessions.tsx` + `app/admin/page.tsx` — Scores UI

- Render **in-progress** rows (`inProgress === true`) as **"In progress"** (no score, no Mins), with a
  **Continue** button **only when the viewer owns the session** (`viewerUser === session.loginUser` — pass
  `viewerUser` down). Continue → `/?resume=<date>`.
- The teacher sees the row as informational (no Continue) and may **Delete** it — the existing
  `DELETE /api/quiz-session` already works on the slot (it's under the `quiz-sessions/` prefix and
  `blobUrl` is attached at load); it must also `del()` the slot audio via `audioUrl` as it does today.
  (If the teacher deletes a slot while the student is actively mid-quiz, the next checkpoint recreates it —
  harmless; note it, don't fight it.)
- Legacy partials (`partial && !inProgress`) render exactly as today — no Continue.
- `fmtScore` shows "In progress" for a slot record; the Details modal shows the transcript-so-far and
  "In progress — not yet graded" instead of a report card.
- **[fix] Surface resumes to the teacher:** any session with `resumeCount > 0` gets a small note in the
  Details modal — *"Resumed N time(s)"* (breadcrumbs carry the exact timing for forensics). This feature
  was requested by a student, and pause-anytime creates a real look-up-the-answer loophole: hear a hard
  vocab/concept question → leave → check the handout → resume and nail it. We're not blocking that
  (Decision 4: leaving must be safe), but the teacher must be able to *see* it — grading integrity has been
  a repeated, deliberate investment in this project.

### 6. `app/api/quiz-report/route.ts` — grade only on End

- Unchanged for the **End** path (grades → writes the completed record). Then, **only after a successful
  final `put`**, delete the slot JSON + slot audio (cookie-derived key). Same for the **Cancel** path.
- Remove the old **auto-graded partial**: an incomplete session is no longer graded here. (The only
  writers of a report are now the End-path grade and the existing `cancelled` / no-answers `"—"` cards.)
- `durationMs` on a resumed session covers the final run's recording only (Phase 1) — Mins will understate
  for resumed sessions; accepted until Phase 2.

### 7. `lib/sessions.ts` — cache-busted reads

One-line change: fetch each blob as `${b.url}?v=${b.uploadedAt.getTime()}` (see *Storage*). Applies to all
session reads, not just slots — harmless for immutable random-suffixed records, correct for the slot.

## Audio semantics (Phase 1)

- **Live run:** segments accumulate exactly as today; End stitches + uploads the run's WAV as today.
- **Pause with the page alive** (failure pause, or the explicit "Leave — continue later" button): stitch +
  upload segments-so-far to the stable slot-WAV key, stamp `audioUrl` (+ `?v=`) and `durationMs` on the
  slot. A never-resumed pause therefore leaves the teacher a playable recording of everything up to the
  pause.
- **Pause via tab-kill / pagehide:** no flush (unreliable on unload) — transcript survives via the
  per-answer checkpoint; that run's audio is lost. Accepted.
- **Resume:** segments start empty. On End, the final record's audio is the final run only; the slot WAV is
  deleted with the slot. So for a paused-and-resumed session the teacher hears the last run only — the
  known "text-first" trade-off, fixed properly in Phase 2.

## Phasing

- **Phase 1 — everything except cross-resume audio.** Status model (`inProgress` flag) + slot +
  `POST/GET/DELETE /api/quiz-progress` + checkpoint/resume/pause re-model in `VoiceQuiz.tsx` + launcher
  chooser + Scores "In progress"/Continue + resumeCount note + runaway→`tutorDone` + Cancel reword + no End
  confirm + cache-busted reads + drop the auto-graded partial. (v1 deferred the launcher entry to Phase 2
  because it rode on `/api/me`; the chooser probes the slot **on click** instead, so it's now nearly free —
  and `/api/me` stays untouched, avoiding a `list()` over the whole ever-growing `quiz-sessions/` prefix on
  every page load for every logged-in user.)
- **Phase 2 — audio continuity (best-effort).** On resume, fetch the slot WAV, decode + prepend to the new
  run's segments; End stitches one continuous file. Any leg fails → fall back to final-run audio.

## Risks / edge cases

- **iOS reliability:** `pagehide`/`visibilitychange` are the hooks (not `beforeunload`); the transcript is
  checkpointed **per answer** precisely so unload-time work doesn't matter. A hard tab-kill loses at most
  the last in-flight turn.
- **Checkpoint↔terminal race:** closed by `finalizeQuiz` awaiting the in-flight checkpoint before
  save+delete (see §4). Fencing still guards everything else; `finalizeQuiz` stays once-guarded; `resume()`
  resets guards like `start()`.
- **Two devices / double continue:** the stable slot is last-write-wins. Acceptable for one student on one
  device; note it, don't over-engineer.
- **Tutor already said `done` before leaving:** `tutorDone` is persisted in the checkpoint, so resume shows
  End immediately (don't force another turn).
- **Grading integrity:** in-progress is never sent to the grader; only End grades, and only a real
  transcript. The no-student-turns `"—"` guard stays. Resumes are visible to the teacher (`resumeCount`).
- **Final save fails on End:** slot is kept (delete only follows a successful save) → the student still has
  Continue; nothing is lost to a storage hiccup.
- **Diagnostics:** `sessionId` stays stable across pause/resume, so the double-save tripwire still reads
  correctly. New breadcrumbs: `checkpoint:ok`, `pause:leave`, `pause:fail`, `resume:begin`,
  `startover:archived`, `backstop:done-forced`.

## CLAUDE.md updates (do with the change)

Revise *Partial attempts* (failures now pause — continuable, ungraded — instead of auto-grading-and-
ending), *Cancelled attempts* (Cancel also clears the slot; Start over archives as `cancelled`; reworded
confirm), *Strict End gating* (failure paths no longer finalize; runaway forces `tutorDone` instead of
auto-saving), *Reviewing results* ("In progress" rows + Continue + resumeCount note), and the session-
schema area (the new `inProgress` flag and the slot's stable keys; `report` stays null until End).

## Rollout

Per the standing voice-quiz rule: build clean, then **smoke-test on a preview deploy / real phone** (iOS
especially) before promoting: one full pause→resume→End, one failure-pause→leave→Continue-from-Scores, one
Start-over, and one Cancel — checking the slot appears/disappears correctly in Blob after each. Only four
students use the feature, so a preview pass is cheap insurance.

## Defaults chosen in this revision (flag if you disagree)

- **Start over archives the abandoned attempt as a `cancelled` record** (teacher-only) rather than
  silently discarding it — consistent with Cancel's "nothing is thrown away."
- **Continue from Scores resumes directly** (no chooser); the chooser lives only on the launcher, where the
  student's intent is ambiguous.
- **`resumeCount` is shown to the teacher** in the Details modal (integrity visibility), not to the student.
- **Continue navigation** stays the `/?resume=<date>` querystring (read via `window.location` on mount, so
  the static home page needs no Suspense boundary).
