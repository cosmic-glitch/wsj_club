# Voice Quiz — data-loss bug found via Anusha's 2026-06-29 session

**Status:** investigation complete, root cause identified in code, fixes proposed but NOT yet
implemented. This doc is for a second reviewer (Codex) to sanity-check before we change anything.

**Why this doc exists:** the human asked me (Claude) to write down my full understanding because I
made several wrong/imprecise claims while investigating (see "Corrections" at the end). Everything in
the **Evidence** and **Root cause** sections below is grounded in the Vercel runtime logs, the saved
Blob record, and the actual source — not memory or the CLAUDE.md prose. Please verify against the
code; challenge anything that doesn't hold up.

---

## TL;DR

Anusha completed a **full** voice quiz on 2026-06-29 (key-ideas + 3 vocab + 3 concepts = 7 spoken
answers, 14 transcript turns). But the saved record contains **only her first answer** (2 turns) and
was graded **9.5/10 on that one answer alone**. Her other 6 answers were **permanently lost**.

Cause: she pressed **End quiz while her first answer was still transcribing**. `end()` is **not
mutually exclusive with the turn loop**: it saved a premature 2-turn snapshot and set the
`endStartedRef` once-guard, but did **not** stop the in-flight `stopSpeaking()`/`nextTutorTurn()`
chain. That chain resolved, appended her answer, and continued the quiz through all of vocab and
concepts. When the session finally hit a terminal error (an OpenAI `quiz-turn` **502 empty
response**), the failure handler called `end()` again — but the once-guard **blocked** it, so the
now-complete 14-turn transcript was never saved.

Her verbatim report — *"I did vocab; the End quiz button wasn't working so I refreshed and my score
was there"* — is **entirely accurate** and is explained exactly by this bug.

---

## Evidence (facts)

### 1. Blob artifacts (`quiz-sessions/2026-06-29/`)
Exactly **one** Anusha record exists: one JSON + one WAV. No second record, no split, no orphaned
`turns/` clips.
- `anusha-...json` — transcript = **2 turns** (tutor opening + 1 student answer). `report.score` =
  `9.5/10`. `partial=false`, `failure=null`. `durationMs=512853`.
- `anusha-...wav` — **16,411,350 bytes**. At 16 kHz mono 16-bit that is
  `(16411350-44)/2/16000 ≈ 512.85 s`, matching `durationMs` exactly → the recording is **only her
  8.5-minute first answer**. No vocab/concept audio anywhere.

### 2. Saved record's `diag.breadcrumbs` (client, frozen at save time)
```
t=94481   start                (session=2b47…  mount=ddbc…  ios=true)
t=94993   tutor-turn:first
t=96416   start-speaking        order=1 ios=true
t=609399  stop-speaking         order=1 ios=true        ← Stop after the 8.5-min answer
t=609967  transcribe:begin
t=631221  end:called            phase=transcribing guard=false reason=end-button sTurns=0 turns=1 segs=1
t=640248  transcribe:ok         chars=5850 sTurns=1
t=640248  tutor-turn:begin
t=640555  save:begin            audio=true dur=512853 partial=false
```
Key point: `end:called` fires at **`phase=transcribing`**, ~21 s into transcribing answer 1 and
**before** `transcribe:ok`. The breadcrumbs stop at `save:begin` because the record is serialized
there — **the continuation is invisible in the saved record**. Only the server logs reveal it.

### 3. Vercel runtime logs — the full session (reconstructed)
`quiz-transcribe` = one student answer transcribed; `quiz-turn` = tutor asks next. All times UTC
(2026-06-30); local ≈ 20:38–20:42 PDT.

| Time (UTC) | Endpoint | Result | Meaning |
|---|---|---|---|
| 03:38:01 | quiz-transcribe | 200 | **Answer 1** — key-ideas (the 8.5-min one) |
| **03:38:22** | quiz-turn | 200 | tutor asks Q2 **— and** `Voice-quiz session saved` fires here: `studentAnswers:1, totalTurns:2, phaseAtEnd:"transcribing", endReason:"end-button"` |
| 03:38:46 | quiz-transcribe | 200 | **Answer 2** — vocab |
| 03:38:48 | quiz-turn | 200 | next |
| 03:39:06 | quiz-transcribe | 200 | **Answer 3** — vocab |
| 03:39:08 | quiz-turn | 200 | next |
| 03:39:19 | quiz-transcribe | 200 | **Answer 4** — vocab |
| 03:39:20 | quiz-turn | 200 | next |
| 03:39:56 | quiz-transcribe | 200 | **Answer 5** — concept |
| 03:39:57 | quiz-turn | 200 | next |
| 03:41:18 | quiz-transcribe | 200 | **Answer 6** — concept |
| 03:41:21 | quiz-turn | 200 | next |
| 03:42:00 | quiz-transcribe | 200 | **Answer 7** — concept |
| **03:42:02** | quiz-turn | **502** | `Tutor turn: empty response for user: anusha turns: 14` — model returned `finish_reason:"stop"`, `completion_tokens:3`, empty content → session dies |

Seven student answers = 1 key-ideas + 3 vocab + 3 concepts, dying just as it reached the 4th concept
(REIT). There is **no** `Voice-quiz session saved` or `Voice-quiz partial session saved` log for the
14-turn session — it was never saved. The only save that fired was the premature 2-turn one at
03:38:22.

---

## Root cause (code-level, `components/VoiceQuiz.tsx`)

The turn loop and `end()` run concurrently and are not coordinated.

1. **Stop → transcribe is a long await.** `stopSpeaking()` sets `phase="transcribing"` (line 727)
   then `await upload(...)` + `await fetch("/api/quiz-transcribe")` (lines 745–759). For an 8.5-min
   clip this await lasts ~30 s.

2. **End quiz fires mid-await.** The End button (lines 1288–1291) calls `void end()` while
   `stopSpeaking()` is still suspended on that await. Nothing cancels the pending promise.

3. **`end()` proceeds and saves a premature snapshot.** In `end()` (line 934): the once-guard
   `endStartedRef.current` is `false`, so it passes the guard (line 946), sets
   `endStartedRef.current = true` (line 950), sets `phase="wrapup"` (line 956). Because the captured
   `phase` closure is `"transcribing"` (not `"recording"`), the "close out an in-progress answer"
   block (line 966) is skipped. It then builds the teacher file (1 segment), tears down, uploads, and
   POSTs to `/api/quiz-report` reading `transcriptRef.current`, which by then is `[opening, answer1]`
   → the **2-turn, 9.5 record**.

4. **The loop is NOT stopped — it continues and overwrites the phase.** `stopSpeaking()`'s transcribe
   await resolves, `appendTurn({role:"student"})` (line 779), then `await nextTutorTurn(false)`
   (line 781). `nextTutorTurn` sets `phase="thinking"` (line 445) then `phase="tutorTurn"` (line 474)
   — **overwriting the `"wrapup"` that `end()` set** — and speaks the next question. The UI flips
   from the wrap-up screen back to the live quiz. The student keeps answering (answers 2–7).

   - *Why it could keep recording after `end()` called `teardown()`:* this student was on **iOS**
     (`ios=true`). The iOS path re-acquires a **fresh mic every answer** (`iosStartCapture`, line 552)
     and recreates its AudioContext if null (lines 555–562), so `teardown()` closing the previous
     context/mic didn't prevent subsequent answers. **On desktop this would likely have differed** —
     `teardown()` nulls `micRef` (line 879–880) and the desktop `startSpeaking`/`ensureAudioGraph`
     path needs `micRef` (line 496, 634), so recording would probably have failed instead of silently
     continuing. Worth confirming; it affects how this bug manifests per-platform.

5. **The real terminal save is blocked by the guard.** At 03:42:02 `quiz-turn` returns 502.
   `nextTutorTurn`'s catch (lines 476–486) calls `failAndEnd("tutor-unreachable", …)` →
   `end()` again. Now `endStartedRef.current === true`, so `end()` logs `end:blocked` and returns
   (lines 946–948) **before** saving. The complete 14-turn transcript is discarded. The guard that
   exists to prevent *double* saves here prevents the *only correct* save.

6. **Final UI state (inference, consistent with the logs):** after the blocked `end()`, `phase`
   remains `"thinking"` (set by the failed `nextTutorTurn`, line 445) and nothing advances it → the
   modal is stuck on "Thinking about your next question…". Pressing End again does nothing (guard
   blocks). This is almost certainly the moment she describes as *"the End quiz button wasn't
   working"*; she refreshed, and the premature 9.5 snapshot was on the Scores page.

### The core invariant that's violated
`end()` is treated as atomic/terminal, but it is neither: (a) it does not abort in-flight turn work,
(b) the loop can set `phase` back to a live value after `end()` set `"wrapup"`, and (c) the
once-guard makes the **first** `end()` win even when that first `end()` captured an incomplete
transcript. Any End pressed while `phase ∈ {transcribing, thinking}` (a turn in flight) can trigger
this.

---

## Impact

### On the human's original question (do the three 9.5s make sense?)
Anusha's `9.5` was computed on **only her key-ideas answer** — 1 of her 7 answers. Her vocab and
concept answers were never graded. So the "three identical 9.5s" are **not** three like-for-like
gradings: hers is a strong grade on a strong first answer, but it doesn't reflect the full quiz she
actually completed. (Arjun's and Mehar's 06-29 records are full quizzes — arjun `studentAnswers:8,
totalTurns:17`; mehar 7 answers — and look unaffected.)

### Broader risk
Any student who presses End while a turn is in flight can (a) get graded on a truncated transcript
and/or (b) lose the remainder of a completed quiz. `phaseAtEnd` is saved on every record, so we can
**audit**: list all `quiz-sessions/**/*.json` where `diag.phaseAtEnd ∈ {transcribing, thinking,
recording}` to find other truncated saves. Recommended as part of the fix.

### Recoverability of Anusha's lost answers
**Unrecoverable.** The full transcript was never saved; per-turn STT clips are deleted by
`/api/quiz-transcribe` after use; the stitched teacher WAV was built from 1 segment. Only her
key-ideas answer survives (transcript + audio). The 9.5 is defensible to keep as-is, but note it
under-samples her real performance.

---

## Proposed fixes (please critique — do not assume these are correct)

### Fix 1 — make `end()` atomic with the turn loop (primary; fixes the data loss)
Requirements the fix must satisfy:
- **Stop the loop from continuing after End.** Introduce a synchronous "ending" flag set at the very
  top of `end()` (before any await). `stopSpeaking()` and `nextTutorTurn()` must check it **after each
  await** and bail out (no `appendTurn`, no `nextTutorTurn`, no `setPhase` back to a live phase) if
  the session is ending.
- **Don't lose the answer that's mid-transcription.** If End is pressed during `transcribing`, prefer
  to **await the in-flight transcription** (with a timeout) and include that answer in the saved
  transcript before grading, then stop — rather than snapshotting without it. (i.e. End should
  capture *the answer in progress* but suppress *the next question*.)
- **Abort in-flight `fetch`es** (`quiz-turn`, `quiz-transcribe`, and ideally the `upload`) via an
  `AbortController` created in `start()` and aborted in `end()`/`cancel()`, so a slow turn can't
  resurrect the loop or waste tokens.
- **Rethink the once-guard vs. premature save.** The guard should still make the *save* run once, but
  it must not let an incomplete early `end()` win over the real terminal state. Options to weigh:
  (a) End-during-turn defers the save until the turn settles (single, complete save); or (b) allow the
  terminal failure path to *supersede* a snapshot (save the fuller transcript, or update the existing
  record) rather than being silently blocked.

Open design question for Codex: is it cleaner to **serialize** End behind the in-flight turn (a
promise/lock the turn loop and `end()` both await), rather than racing flags? A single "operation in
progress" lock that End waits on may be less bug-prone than sprinkling `if (ending) return` after
every await.

### Fix 2 — `quiz-turn` empty-response resilience (fixes the trigger)
`app/api/quiz-turn/route.ts` lines 95–99 return 502 when the model's content is empty. The 502 that
killed this session was an OpenAI **empty completion** (`finish_reason:"stop"`, `completion_tokens:3`,
blank content) — transient. Add a **one-shot retry** (re-request once on empty/short content) before
returning 502. With Fix 1 in place a 502 no longer loses data, but avoiding the 502 entirely is
cheap insurance.

### Fix 3 — surface truncated/blocked sessions server-side (monitoring)
Today a `end:blocked` is only a client breadcrumb in the *lost* session's memory — it never reaches
the server, so a truncated quiz is invisible in logs except by manually correlating a `turns:14` 502
with a `totalTurns:2` save. Add a lightweight server beacon (e.g. `navigator.sendBeacon` to a tiny
`/api/quiz-diag` route) when `end()` is blocked or when a session ends at a live phase, so these are
greppable. Also consider a one-time audit of existing records by `diag.phaseAtEnd` (see Impact).

### Fix 4 — Anusha's grade (product decision, not code)
Her lost answers can't be recovered. Given she demonstrably completed the full quiz, options: leave
the 9.5 (fair for the first answer), or have her retake. This is the human's call, not a code fix.

---

## Corrections — where my earlier claims were wrong (so Codex can discount my priors)
1. **First pass:** I implied the tutor "moved on with no follow-up because her retelling cleared the
   bar." Wrong — that was an artifact of reading only the truncated 2-turn saved transcript.
2. **Second pass:** I said "she pressed End and the tutor never got to ask vocab/concepts; she was
   never tested on vocab." Wrong — she **was** asked and **did** answer all vocab + concepts; those
   turns were lost, not skipped.
3. **Second pass:** I floated that she was "misremembering / conflating concepts with vocab." Wrong
   and unfair — the logs prove she did the vocab round.
4. **Second pass:** I proposed the fix as simply "make End wait for transcription / show a non-frozen
   wrap-up." That's necessary but **not sufficient** — it misses the core defect (the loop continues
   and the guard blocks the real save). The real fix must stop the loop and fix the save/guard
   semantics (Fix 1).
5. What held up: the 502-empty-response as trigger, the premature 2-turn save, and "her account is
   accurate" — all confirmed by logs + code.

## Verification pointers for Codex
- `components/VoiceQuiz.tsx`: `end()` 934–1055 (guard 946–950, phase set 956, recording-only closeout
  966–977, save POST 1025–1044); `stopSpeaking()` 694–792 (transcribe await 755–759, appendTurn 779,
  `nextTutorTurn` 781); `nextTutorTurn()` 443–487 (phase 445/474, failure→`failAndEnd` 482); iOS
  capture 552–614; `teardown()` 837–881; once-guard/`cancel()` 1061–1066.
- `app/api/quiz-turn/route.ts`: empty-response 502 at 95–99.
- `app/api/quiz-report/route.ts`: no-student-turns "—" path 114–124; save + `Voice-quiz session
  saved` log 209–223.
- Reproduce: start a quiz, give one answer, press **End quiz while "Transcribing…" is showing**;
  observe whether the quiz continues past the wrap-up and whether the saved record is truncated.
  Test **both iOS and desktop** (the platforms likely differ — see Root cause §4).
