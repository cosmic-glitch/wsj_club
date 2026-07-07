# Plan — Continuable voice-quiz sessions (pause & resume)

> **Status:** Design approved by the product owner (decisions below); **not yet implemented.**
> Companion to the *Voice quiz* section of `CLAUDE.md` (esp. *Strict End gating*, *Partial attempts*,
> *Cancelled attempts*). Code sketches are illustrative pseudo-diffs against the real
> `components/VoiceQuiz.tsx`, `app/api/quiz-report/route.ts`, `components/AdminSessions.tsx`,
> `app/admin/page.tsx`, and `app/api/me/route.ts` — **verify against the real files; don't paste blindly.**

## Why

Student feedback (Arjun, after the 2026-07-06 quizzes):

> "Make it so if you leave the page instead of finalizing it saves your response and next time you click
> voice quiz it continues. It should only cancel if you press cancel and only finalize if you press
> finalize. Also add confirmations to cancel/finalize."

Today, **leaving the page mid-quiz loses everything** — the unmount cleanup in `VoiceQuiz.tsx` only aborts
fetches and releases the mic; it never saves. And a transcription/tutor **failure auto-finalizes** a graded
*partial* with no button press (`failAndEnd`). Arjun wants the opposite: leaving/failing should **pause**
(not lose, not finalize, not cancel), and a paused attempt should be **continuable from the UI**.

## Decisions already made (product owner)

1. **Continue lives in two places:** the student's **partial entry on the Scores page** *and* the home
   **Voice quiz launcher** (clicking it for a day with an in-progress attempt offers Resume).
2. **In-progress = no score.** A paused attempt shows in Scores as **"In progress"** with a **Continue**
   button and **no grade**. It's graded **only** when finished with **End**. (This changes today's
   behavior, where a partial gets a real score.)
3. **Only buttons are terminal.** Failures / hangs / leaving all save a **continuable** partial. A session
   is graded-and-completed **only on End**, and ended-for-good **only on Cancel** (Cancel does NOT throw the
   work away — it still saves an ungraded, teacher-only `cancelled` record; it just doesn't count and isn't
   continuable). Nothing auto-finalizes or
   auto-cancels. **No stale cleanup** for now — partials persist until the student finishes or cancels them.
4. **No End confirmation.** End is already gated to the true end (strict End-gating, shipped 2026-06-29):
   it only appears once the tutor signals `done`, so a confirm there is pure friction. **Cancel keeps its
   confirm** — it's the one exit that ends the attempt *for good* (no Continue). Note it still **saves** an
   ungraded, teacher-only `cancelled` record (it does NOT discard the work); the confirm is reworded only to
   distinguish "end it" from "leave and continue later."
5. **Audio is best-effort ("text-first").** Transcript + grade always resume whole. The recording for an
   interrupted-then-resumed session may have gaps; full cross-resume audio stitching is deferred (Phase 3).

## The model: existing vs. new

| Exit | Today | New |
|---|---|---|
| **End** (shown only when tutor `done`) | grade + save complete (`partial:false` + report) | unchanged |
| **Cancel** | save ungraded `cancelled` (teacher-only) | unchanged, reworded confirm; also **deletes the partial slot** |
| **Leave / reload / iOS tab-kill** | **silent total loss** | **checkpointed `partial` (ungraded)** → continuable |
| **Failure / hang / runaway** | `failAndEnd` → graded **partial**, ends | keep session **`partial` (ungraded)** (retry or leave); **no auto-grade, no terminal end** |

**Why Cancel "deletes the partial slot":** during the quiz, each answer checkpoints the transcript to the
in-progress slot (`…-inprogress.json`) — and *that blob's existence is literally what shows the student a
"Continue" affordance* (on Scores and the launcher). So when the student Cancels, writing the terminal
`cancelled` record is not enough on its own: if the slot were left behind, the student would **still see
"Continue"** for a quiz they just chose to end, and there'd be **two live records for one attempt** (the
`cancelled` one *and* the lingering in-progress one). Deleting the slot is what makes Cancel's "not
continuable" real — and it frees the one-per-day slot for a fresh retake. It's the exact same reason **End**
deletes the slot; Cancel and End are both terminal, so both must remove it (Leave/failure do the opposite —
they *write* the slot). The delete is best-effort/idempotent: a very early Cancel (before any checkpoint)
simply has no slot to remove.

*This is NOT something Cancel does today.* Today the quiz persists **nothing at the session level until the
final save**, so there is no mid-quiz blob to clean up — Cancel just writes the one `cancelled` record. The
slot, and therefore its deletion, exist **only because checkpointing is new**: once we write a growing
in-progress blob to enable resume, a terminal action has to remove it. (The only mid-quiz Blob writes today
are the transient per-answer transcription clips under `turns/`, deleted by the *transcribe* route, not by
Cancel — those aren't a session record.)

### No new status field — reuse `partial`

The existing booleans already express every state; **no `status` enum is added.** `partial` today means
"incomplete attempt" — the new model just **broadens** it from "ended by a failure" to "incomplete for any
reason (failed **or** paused **or** still mid-quiz)." The `failure` field keeps recording *why* (a clean
leave → `failure: null`; a failure → `failure: {…}`).

The only real subtlety — telling a **new, continuable** partial apart from a **legacy, already-graded**
partial (e.g. Arjun's old 9/10) — falls out of one rule change: **going forward we grade only on End, so a
live/paused partial has `report: null`.** So, read off existing fields:

| Record | Means | Scores shows |
|---|---|---|
| `partial && report == null` | **in progress** (checkpointed, never graded until End) | "In progress" + **Continue** |
| `partial && report != null` | **legacy** graded partial | exactly as today (partial badge, score, **no** Continue) |
| `cancelled` | ended via Cancel — **saved** ungraded, not continuable | today's grey badge, teacher-only |
| neither | complete | the grade |

No migration, no derived `status`; `report == null` cleanly separates new from legacy. Continue keys off
`partial && report == null`.

## Storage

**"The in-progress slot"** is the single Blob record that holds a *paused, continuable* attempt — a
`partial` record with `report: null` (see the table above). Its mere existence **is** the "this quiz can be
resumed" state: it's what makes the attempt show up as **"In progress" + Continue** on Scores and drives the
launcher's **"Continue quiz"**. There is **at most one per (student, date)**.

- **Stable key, overwritten on each checkpoint** so a paused attempt is always *exactly one* blob that
  grows in place — never a pile of per-checkpoint blobs: `quiz-sessions/<date>/<safeName>-inprogress.json`
  (`put(..., { addRandomSuffix: false })`). Completed/cancelled records keep today's `…-<Date.now()>.json`
  with `addRandomSuffix: true`.
- **"Delete the in-progress slot" = end the continuable state.** When an attempt reaches a **terminal
  button** — **End** (→ the graded, completed record: `partial:false` + report) or **Cancel** (→ the
  ungraded `cancelled` record) — we write that final record under the normal random-suffixed key **and then
  `del()` the `-inprogress.json` blob** (plus its best-effort in-progress audio blob). This deletion is
  required because:
  - **Otherwise the student keeps seeing a stale "Continue"** for a quiz they already finished or cancelled,
    and could resume something that's already been graded (End) or ended (Cancel) — two live representations
    of one attempt.
  - It **frees the one-per-day slot** so a *fresh* attempt that same day can start clean.

  So a *finished* day looks exactly like today — one random-suffixed `complete` record, no slot. The stable
  slot exists **only while an attempt is paused**; **End and Cancel are the two events that remove it**
  (leaving/failing does the opposite — it *creates or updates* the slot).
- **teacherId** is stamped on the slot too (same `getUser(user).teacherId` lookup), so Scores scoping works
  while it's still in progress.

## New / changed surfaces

### 1. `POST /api/quiz-progress` (new, login-gated) — checkpoint

Upserts the `-inprogress.json` slot. **Never grades, never calls the model** — so the slot always has
`report: null`, which is exactly the "in progress" signal. Body: `{ date, transcript, tutorDone, audioUrl?,
durationMs?, sessionId, mountId, breadcrumbs }`. Writes `{ …, partial: true, report: null, cancelled: false,
teacherId, tutorDone, updatedAt }`. Sanitize/cap like `quiz-report` does. Returns `{ ok: true }`. (Reuses
the `quiz-report` field-validation helpers — factor the shared bits out.)

### 2. `GET` for resume — load the in-progress transcript

Either a `GET /api/quiz-progress?date=` returning the slot's session JSON, **or** fold the list of the
student's in-progress **dates** into `/api/me` (it's already fetched once per page by `AuthProvider`) and
fetch the full slot on Continue. Plan: **`/api/me` returns `inProgress: string[]` (dates)** for the launcher
badge; a small `GET /api/quiz-progress?date=` returns the full transcript for the actual resume.

### 3. `components/VoiceQuiz.tsx` — checkpoint + resume + failure re-model

- **Checkpoint** after every transcribed answer and every tutor turn: `void checkpoint()` → POST
  `/api/quiz-progress` with `transcriptRef.current` + `tutorDone` (best-effort, fenced by `runId`; a late
  checkpoint from a stale run must not overwrite a newer slot — guard with `canContinue(runId)`).
- **`resume(session)`** (new, parallel to `start()`): set `transcriptRef` to the loaded transcript, render
  the log, re-acquire mic (the relaunch click is the user gesture), bump `activeRunIdRef`, reuse the saved
  `sessionId` (so the slot key + diagnostics stay linked), reset `endStartedRef`/`endingRef`, restore
  `tutorDone` from the checkpoint. Then continue the loop: if the last turn is a **student** answer →
  `nextTutorTurn(false, runId)`; if it's a **tutor** question → phase `tutorTurn` (student presses Start
  speaking); if `tutorDone` → show **End** immediately. **Skip the fixed-opening fast-path** (that's
  fresh-start only). Segments start empty (Phase 1: audio from resume onward).
- **`failAndEnd` → `pauseOnFailure`:** a transcription/tutor failure, hang, or `MAX_TURNS` runaway **no
  longer** calls `finalizeQuiz`. Instead: stop the loop, keep the checkpoint (already saved), and show a
  recoverable state — "Couldn't reach the tutor. [Try again] [Leave — continue later]". `finalizeQuiz` is
  now reached **only** by `userEnd()` (End) and `cancel()` (Cancel). The once-guard + run-fencing stay, but
  only guard those two.
- **Unmount / `pagehide` / `visibilitychange→hidden`:** do **not** finalize. Ensure the latest checkpoint is
  flushed (transcript already is per-answer); best-effort audio flush is Phase 3. Release mic as today.
- **Cancel reword** (`confirmCancel`): *"Cancel this quiz? It won't count and you won't be able to continue
  it later. (To keep it for later, just leave — you can resume from your Scores.)"* On confirm, `cancel()`
  saves the `cancelled` record and **deletes the in-progress slot**.

### 4. `components/AdminSessions.tsx` + `app/admin/page.tsx` — Scores UI

- Render **in-progress** rows (`partial && report == null`) as **"In progress"** (no score, no Mins), with
  a **Continue** button **only when the viewer owns the session** (`viewerUser === session.loginUser`).
  Continue → navigate to `/?resume=<date>` (home), where the day's `VoiceQuiz` auto-opens in resume mode.
- Students already see their own attempts; in-progress ones simply gain Continue. Teacher sees the entry as
  informational (no Continue) and may still **Delete** it (teacher-only, unchanged). Legacy graded partials
  (`partial && report != null`) render exactly as today — no Continue.
- Grading/score columns: `fmtScore` shows "In progress" for an in-progress record; Details modal shows the
  transcript-so-far and "In progress — not yet graded" instead of a report card.

### 5. Home launcher — `VoiceQuiz.tsx` / `VoiceQuizStep.tsx`

- Read `inProgress: string[]` from the shared `AuthProvider` (`/api/me`). If the day is in it, the action
  reads **"Continue quiz"** and `launch()` enters resume mode (fetch the slot, `resume(session)`); otherwise
  it's the normal fresh start. Logged-out behavior unchanged (login prompt on click).

### 6. `app/api/quiz-report/route.ts` — grade only on End

- Unchanged for the **End** path (grades → writes the completed record: `partial:false` + report).
  Additionally: **delete the `-inprogress.json` slot** after a successful complete/cancel save.
- Remove the old **auto-graded partial**: an incomplete session is no longer graded here, so a live/paused
  `partial` always has `report: null`. (The only writers of `report`/score are now the **End**-path grade
  and the existing `cancelled` / no-answers `"—"` cards.)

## Phasing

- **Phase 1 — core (ship first).** Status model + `-inprogress` slot + `POST /api/quiz-progress` checkpoint
  (transcript) + `resume()` turn-loop + **Continue from the Scores entry** + "In progress, no score" display
  + failure/leave → continuable (drop the auto-graded partial) + Cancel reword + no End confirm. Audio =
  final-run-only (best-effort; no cross-resume merge yet).
- **Phase 2 — launcher entry point.** `/api/me` `inProgress` + "Continue quiz" on the home row.
- **Phase 3 — audio continuity (best-effort).** Flush a stitched WAV of the run-so-far to the slot at pause
  points; on End, fetch the prior slot WAV, decode + prepend to the new run's segments, stitch one file. If
  any leg fails, fall back to the final run's audio.

## Risks / edge cases

- **iOS reliability:** `pagehide`/`visibilitychange` are the events to hook (not `beforeunload`); large async
  flush on unload is unreliable, which is exactly why the transcript is checkpointed **per answer** rather
  than only on leave. A hard tab-kill loses at most the last in-flight turn.
- **Concurrency:** checkpoints and the resume run must respect `activeRunIdRef`/`mountedRef` fencing so a
  stale run can't overwrite a newer slot or resurrect an ended quiz. `finalizeQuiz` stays once-guarded;
  `resume()` resets the guards like `start()`/`close()`.
- **Two devices / double continue:** the stable slot is last-write-wins. Acceptable for one student on one
  device; note it, don't over-engineer.
- **Tutor already said `done` before leaving:** persist `tutorDone` in the checkpoint so resume can show End
  immediately (don't force another turn).
- **Grading integrity:** in-progress is never sent to the grader, so the "no-answers 8/10" class of bug
  can't reappear via checkpoints. Only End grades, and only a real transcript.
- **Diagnostics:** keep `sessionId` stable across a pause/resume (reuse it in `resume()`), so the breadcrumb
  trail and the "saved twice" tripwire still read correctly across a continued session. Add breadcrumbs:
  `checkpoint:ok`, `pause:leave`, `pause:fail`, `resume:begin`.

## CLAUDE.md updates (do with the change)

Revise *Partial attempts* (partials are now **continuable, ungraded** — not auto-graded-and-ended),
*Cancelled attempts* (Cancel also clears the in-progress slot; reworded), *Strict End gating* (failure paths
no longer finalize), and *Reviewing results* (the "In progress" row + Continue button; students see their own
in-progress attempts). Note the **broadened meaning of `partial`** (now = incomplete/continuable and
**ungraded** — `report: null` — until End; no new `status` field) in the session-schema area.

## Rollout

Per the standing voice-quiz rule: build clean, then **smoke-test one full pause→resume→End on a preview
deploy / real phone** (iOS especially) before promoting. Only four students use the feature, so a preview
pass is cheap insurance.

## Open questions (confirm before/while implementing)

- **Continue navigation:** `/?resume=<date>` querystring vs. a dedicated route — querystring is simplest and
  keeps the launcher on the home page. OK?
- **"Start over" when a slot exists:** if a student opens a day that already has an in-progress slot and
  wants a fresh quiz, offer **Continue / Start over** (Start over overwrites the slot). Confirm that's the
  desired affordance.
- **Teacher Delete of an in-progress slot:** allowed (cleanup), and it should delete the stable
  `-inprogress.json` blob (+ any audio). Confirm.
