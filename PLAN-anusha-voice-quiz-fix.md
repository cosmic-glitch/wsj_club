# Implementation plan (v6 — APPROVED) — fix the Voice Quiz end()/turn-loop data-loss bug

Companion to `BUG-anusha-voice-quiz.md`. **Status: approved for implementation.** The approved fix is
**structural**, decided by the product owner: **"End quiz" appears only once the tutor signals the
quiz is complete — never mid-turn, and never at an intermediate rest point.** That makes the
end()-races-a-turn bug class *impossible by construction*, and lets us delete the concurrency machinery
v2/v3 added to *handle* a mid-turn End. Code sketches are illustrative pseudo-diffs against the current
`components/VoiceQuiz.tsx` (+ `app/api/quiz-turn/route.ts`, `lib/quiz-prompt.ts`) — verify against the
real files; don't paste blindly.

---

## 0. Review trail

- **v1 (Claude):** make `end()` terminal + coordinate with the in-flight turn. *Codex:* async leaks
  across runs.
- **v2:** added the `activeRunIdRef` generation token + `isSameRun`/`canContinue`. *Codex:* tighten
  post-await checks, controller capture, unmount, timeout, partial-on-final-failure.
- **v3:** folded those in (bounded settle, timeout-invalidation, partial-on-failure, mountedRef).
- **v4:** product owner chose to gate End to rest points; removed the settle/timeout machinery. *Codex:*
  v4 still enabled End at **every** `tutorTurn`, which contradicts the "not a logical end till the tutor
  is done" reasoning.
- **v5:** product owner confirmed **strict** gating — **End is available only when the tutor has
  signalled the quiz is done.** Early voluntary stop = **Cancel (discards)**. Added a **turn-count
  backstop** (auto-saves a partial, doesn't expose End) + hardened done-detection. *Codex:* the plan's
  prose blurred "user End" (gated) with the "internal finalize" that `failAndEnd()` triggers (any phase).
- **v6 (this doc):** split the two entry points from the shared save path (`userEnd()` /
  `failAndEnd()` → `finalizeQuiz()`), and corrected the diagnostics expectation — an `end:called` at a
  non-`tutorTurn` phase is **expected** when `endReason` is a `fail:*`, suspicious only when it's
  `end-button`.

**Net vs v4:** strict End (only when `tutorDone`) + backstop + hardened done-detection + an explicit
user-End/internal-finalize split. All the leak-fencing and simplifications from v4 stay.

---

## 1. Interaction model (strict)

Live phases: `tutorTurn` (question on screen, waiting for the student), `recording`, `transcribing`,
`thinking`. Plus a `tutorDone` flag set once the tutor signals completion.

| Phase | Start speaking | End quiz | Cancel quiz |
|---|---|---|---|
| `tutorTurn`, **not** done | ✅ shown | ⛔ **hidden** | ✅ |
| `tutorTurn`, **done** | ⛔ hidden | ✅ **shown, primary** | ✅ |
| `recording` | (Stop shown) | ⛔ hidden | ✅ |
| `transcribing` | — | ⛔ hidden | ✅ |
| `thinking` | — | ⛔ hidden | ✅ |

- **End can only fire when `phase === "tutorTurn" && tutorDone`.** So `end()` never overlaps a
  transcribe/turn, and never ends the quiz before the tutor has wrapped up.
- **Cancel is always available** during a live quiz and **discards everything** (no save). It is the
  only way to stop before the tutor is done — a deliberate nudge to finish the quiz.
- **Mid-quiz API failures / hangs** still auto-save a **partial** and end (unchanged). So "stopping" is
  never how work gets saved incompletely; only a genuine failure produces a partial.
- **No intermediate End.** (Explicitly dropped from v4 — see §6.)

---

## 2. Invariants (acceptance criteria)

- **I1 — End only at the true end.** End fires only when `phase === "tutorTurn" && tutorDone`; never
  mid-turn, never at an intermediate rest point.
- **I2 — No lost answers on End.** There is no in-flight turn when End is allowed, so End can't truncate
  one.
- **I3 — Exactly one save** (once-guard); a clean End is the full, completed transcript.
- **I4 — Mid-quiz failure/hang saves a partial** and ends on its own.
- **I5 — No trap.** A missed `done` signal can't strand a student: a turn-count backstop auto-ends with a
  partial save (§5).
- **I6 — Both platforms** (desktop MediaRecorder + iOS fresh-mic-per-turn).
- **I7 — Cross-run isolation.** A stale async op from a previous/cancelled/unmounted quiz can never
  mutate a newer quiz (generation token). Still required — Cancel/unmount are live mid-turn.
- **I8 — Failures visible.** Every failure/hang/backstop path saves `partial` + a `failure` reason.

---

## 3. State primitives (`components/VoiceQuiz.tsx`, ~line 300–325)

```ts
const activeRunIdRef = useRef(0);   // generation; bumped in start()/close()/unmount
const endingRef = useRef(false);    // "this run is terminating"; set at top of end()/cancel()
const mountedRef = useRef(true);    // false after unmount
const turnAbortRef = useRef<AbortController | null>(null);       // quiz-turn + TTS fetches
const transcribeAbortRef = useRef<AbortController | null>(null); // transcribe fetch
const [tutorDone, setTutorDone] = useState(false);              // tutor signalled completion → End appears
```
Keep existing `endStartedRef` (once-guard). Helpers:
```ts
const isSameRun   = (runId: number) => activeRunIdRef.current === runId && mountedRef.current;
const canContinue = (runId: number) => isSameRun(runId) && !endingRef.current;
```
**Controller-capture rule:** each async op reads `*AbortRef.current` **once into a local** at the top —
never after an await. (`inFlightTurnRef` from v3 is not needed — there's no in-flight turn to await on
End.)

---

## 4. Per-function changes

### 4.1 Button gating (footer, lines 1285–1303) + Start speaking (line 1214)
```tsx
{/* End: ONLY when the tutor is done. Primary style. Calls userEnd() (gated). */}
{phase === "tutorTurn" && tutorDone && (
  <button onClick={userEnd} className={/* primary/emphasized */}>End quiz</button>
)}
{/* Cancel: always available while live. */}
<button onClick={cancel}>Cancel quiz</button>
```
```tsx
{/* Start speaking: only while the tutor is NOT done (still asking). */}
{phase === "tutorTurn" && !tutorDone && (<button onClick={startSpeaking}>🎙 Start speaking</button>)}
{phase === "tutorTurn" && tutorDone && (
  <p className="…helper…">You're all done — press <b>End quiz</b> to finish and see your report.</p>
)}
```

### 4.2 `nextTutorTurn(first, runId)` (line 443) — consume `done`; abortable; fenced; backstop
```ts
const turnAbort = turnAbortRef.current;                       // capture ONCE
const res = await fetch("/api/quiz-turn", { signal: turnAbort?.signal, ... });
const data = await res.json().catch(() => null);
if (!res.ok || !data?.text) throw new Error(...);
if (!canContinue(runId)) return;                              // ending/stale → discard (I1/I7)
appendTurn({ role: "tutor", text: data.text });
if (data.done === true) setTutorDone(true);                  // tutor wrapped up → End appears, Start speaking hides
setPhase("tutorTurn");
void speak(data.text, order, runId);
// catch: if (!isSameRun(runId) || endingRef.current || err.name === "AbortError") return; else failAndEnd("tutor-unreachable", …)
```
(`start()` sets `setTutorDone(false)`.)

### 4.3 `stopSpeaking()` (line 694) — fenced; local controller; backstop check
Same as v4 (run/mounted/abort fencing only — no End-race handling). One addition: before calling the
next turn, enforce the runaway backstop (§5):
```ts
appendTurn({ role: "student", text });
if (!canContinue(runId)) return;
if (transcriptRef.current.length >= MAX_TURNS) {              // runaway: tutor never signalled done
  failAndEnd("quiz-runaway", "The quiz ran unusually long without wrapping up; saved what we have.");
  return;
}
await nextTutorTurn(false, runId);
```
(Full fenced body — upload/transcribe with `transcribeAbort` signal, `isSameRun` checks after `upload()`
and around `appendTurn`, `failAndEnd` on genuine transcription failure — is unchanged from v4 §4.3.)

### 4.4 `startSpeaking()` (line 619) — fence the mic-setup await
```ts
if (phase !== "tutorTurn" || tutorDone) return;              // no new answers once done
const runId = activeRunIdRef.current;
// await iosStartCapture()/ensureAudioGraph()
if (!canContinue(runId)) return;
setRecSeconds(0); startMeterLoop(); setPhase("recording");
```

### 4.5 `speak(text, order, runId)` (line 412) — fenced; local controller
Unchanged from v4: capture `turnAbortRef.current` once; after the fetch, `if (!canContinue(runId))
{ setTtsPlaying(false); return; }` before `pushSegment`/play.

### 4.6 Split `end()` → `finalizeQuiz()` + `userEnd()` + `failAndEnd()` (Codex v5 note)
`end()` today is called by **both** the End button and `failAndEnd()`, which blurs "user End" (must be
gated) with "internal finalize on failure" (must run at any phase). Split the two entry points from the
shared, once-guarded save path:
```ts
// Shared save/teardown (the current end() body). `reason` → endReason. Still ONE save (I3):
async function finalizeQuiz(reason: string) {
  const phaseAtEnd = phaseRef.current;
  logEvent("end:called", `phase=${phaseAtEnd} guard=${endStartedRef.current} reason=${reason} …`);
  if (endStartedRef.current) { logEvent("end:blocked"); return; }
  endStartedRef.current = true; endingRef.current = true; endReasonRef.current = reason;
  turnAbortRef.current?.abort();                 // stop a trailing TTS
  setPhase("wrapup");
  // buildTeacherFile → teardown → upload + POST /api/quiz-report (existing body).
  // NO recorder closeout / NO settle — see below.
}

// USER End: allowed ONLY at the true end. Defensive guard even though the button is rendered
// only when tutorDone:
function userEnd() {
  if (phase !== "tutorTurn" || !tutorDone) return;    // gate (UI already hides End otherwise)
  void finalizeQuiz("end-button");
}

// INTERNAL end on failure/hang/backstop: record the failure, then finalize a PARTIAL from ANY phase:
function failAndEnd(reason: string, detail: string) {
  recordFailure(reason, detail);                       // → failureRef → partial=true in finalizeQuiz
  void finalizeQuiz(`fail:${reason}`);
}
```
So **user End is gated** (`tutorTurn && tutorDone`); **internal finalize is not** (failure/hang/backstop
saves a partial from any phase). `finalizeQuiz` needs no recorder-closeout or settle: a user End can't
fire mid-turn (gated), and an internal finalize just saves whatever's captured so far.

### 4.7 `cancel()` (1061) & `close()` (1068) — fence stragglers (unchanged from v4)
```ts
function cancel() {
  endReasonRef.current = "cancel"; logEvent("cancel");
  endingRef.current = true; endStartedRef.current = true;
  turnAbortRef.current?.abort(); transcribeAbortRef.current?.abort();
  close();
}
function close() {
  activeRunIdRef.current += 1; endingRef.current = false; setTutorDone(false);
  // existing resets
}
```

### 4.8 Unmount (effect at line 1087) — real fencing (unchanged from v4)
```ts
return () => { mountedRef.current = false; activeRunIdRef.current += 1;
  turnAbortRef.current?.abort(); transcribeAbortRef.current?.abort(); teardown(); };
```

### 4.9 `start()` (line 885)
```ts
const runId = (activeRunIdRef.current += 1);
endingRef.current = false; setTutorDone(false);
turnAbortRef.current = new AbortController(); transcribeAbortRef.current = new AbortController();
// existing resets; guard the rejected-mic path with isSameRun before setError/setPhase
await nextTutorTurn(true, runId);
```

### 4.10 Server: `/api/quiz-turn/route.ts` + `lib/quiz-prompt.ts` — reliable `done` + retry
Because End is now **gated on `done`**, the signal must be reliable. **Preferred: structured output.**
- Convert the tutor call to `response_format: { type: "json_object" }` and instruct the tutor (in
  `buildInstructions`) to return `{"text": "<the spoken line>", "done": <true only on the final wrap-up
  turn, else false>}`. Extract `text` for display/TTS and `done` for gating.
- **Defensive backup:** if a turn isn't valid JSON (parse fails), fall back to treating the raw content
  as `text` and detect completion by the exact mandated wrap-up phrase — "The quiz is done. You can press
  the End Quiz button." — as `done`. If neither JSON `done` nor the phrase is present, `done = false`.
- **Empty-response retry** (lines 94–99): retry once before 502. Keep.
- Never expose a done "fallback" from turn count on the client — a runaway is handled by the backstop
  (§5), which **auto-saves a partial**, not by showing End.

(Alternative if we don't want JSON mode: keep plain text + a strippable `<<QUIZ_DONE>>` sentinel *and*
the exact-phrase backup. Structured is preferred for a gating signal; reviewer's call. Either way, keep
the sentinel/marker out of anything spoken or shown.)

---

## 5. Backstop + fetch timeouts (so strict gating can't trap or wedge)

- **Runaway backstop (I5):** `const MAX_TURNS = 24;` (a normal quiz is ~14 turns). In `stopSpeaking()`,
  before `nextTutorTurn`, if `transcriptRef.current.length >= MAX_TURNS`, call `failAndEnd("quiz-runaway",
  …)` → auto **partial** save + clean end. This is the safety valve for a `done` signal that never fires:
  the student's work is saved and the quiz ends without ever exposing a mid-quiz End button.
- **Fetch timeouts (I4/I5):** put a timeout (AbortController + `setTimeout(abort, FETCH_TIMEOUT_MS)`, cleared
  on settle; `≈60s`) on the `quiz-turn` and `quiz-transcribe` fetches so a genuine hang becomes a failure
  → `failAndEnd` → auto **partial** save. Since End is no longer a manual escape, this guarantees a stuck
  quiz still ends and saves.

---

## 6. Explicitly removed / dropped (do not re-add)

- **Intermediate End** (v4 allowed End at every `tutorTurn`): removed. End is `tutorDone`-only.
- From v2/v3, unnecessary once End can't fire mid-turn: `inFlightTurnRef` + bounded settle,
  `TURN_SETTLE_MS`, timeout-invalidation-on-End, the End-time `recording` closeout, and the
  `final-answer-*` partial cases. (The generation-token fencing is **kept** — see I7.)

---

## 7. Decisions (settled)

- **D1 — Strict End:** rendered only when `phase === "tutorTurn" && tutorDone`; Start speaking hidden
  then. Cancel always live and **discards**.
- **D2 — Reliable `done`:** structured `{text, done}` from `/api/quiz-turn` (preferred), with exact-phrase
  backup; neither ⇒ not done.
- **D3 — Runaway backstop** (`MAX_TURNS`) auto-saves a partial rather than exposing End (I5).
- **D4 — Keep generation-token fencing** for Cancel/unmount/trailing-speak.
- **D5 — Fetch timeouts** turn hangs into partial saves.
- **D6 — `quiz-turn` empty-response retry** stays.
- **D7 — Split entry points:** `userEnd()` (gated: `tutorTurn && tutorDone`) and `failAndEnd()` (any
  phase, saves partial) both funnel through one once-guarded `finalizeQuiz(reason)`. The `reason`
  (`end-button` vs `fail:*`) distinguishes them in diagnostics.

## 8. Optional / follow-up

- **P1** — non-alarming transcribe progress copy (the original trigger for Anusha reaching for End).
- **P2** — if desired later, a distinct "Stop & save early" affordance (currently early stop = Cancel =
  discard, per D1). Not in scope.

---

## 9. Test plan

**Both iOS Safari and desktop Chrome (I6):**
1. Normal full quiz → clean save, full transcript, correct score. (Regression.)
2. **End is not present at any `tutorTurn` until the tutor is done** — only Start speaking + Cancel; and
   End is never present during `recording`/`transcribing`/`thinking`. (The strict rule + the bug's root.)
3. Reach the tutor's wrap-up → **Start speaking hides, End appears primary**; End → clean save. (`done`.)
4. **`done` never fires** (simulate the model omitting it): the quiz keeps going and, at `MAX_TURNS`,
   **auto-saves a partial** and ends — End is never exposed as a fallback. (I5 backstop.)
5. **Cancel** at any phase (incl. mid-answer) → nothing saved; loop stops. (Early stop = discard, D1.)
6. **Cross-run leakage (I7):** start → reach `transcribing` → **Cancel** → immediately start a new quiz;
   the old transcribe/turn/TTS resolving must NOT append/speak/setPhase into the new run. (Throttle.)
7. **Unmount mid-op:** close modal / navigate away while a fetch is in flight → no post-unmount state
   update / console error.
8. **Forced `quiz-turn` 502** mid-quiz → **partial** with full transcript-so-far.
9. **Empty completion** → single empty response no longer ends the quiz (retry).
10. **Hung transcribe/turn (> `FETCH_TIMEOUT_MS`)** → auto **partial** save + clean end (§5).
11. **Trailing speak() after End:** End when done while the wrap-up TTS is still fetching/playing → no
    late segment, no audio after teardown.
12. **Structured-output parse failure** (simulate non-JSON turn) → falls back to raw text + phrase
    detection; quiz continues; TTS/display show the line, not raw JSON.

**Instrumentation:** exactly one `Voice-quiz session saved` per quiz; a saved `end:called` with
`endReason="end-button"` should only ever appear at `phase=tutorTurn` with `tutorDone` (suspicious
otherwise); an `end:called` with `endReason` starting `fail:` is **valid at any phase** (failure/hang/
backstop); `done` reflected on the wrap-up turn; the backstop path saves `partial` +
`failure.reason="quiz-runaway"` (endReason `fail:quiz-runaway`).

`npm run build` clean.

---

## 10. Risk / rollout / do-not-touch

- **Risk:** low — the hardest path (End mid-turn) is eliminated. Verify tests 4/6/7/10/11/12 on **both**
  platforms, especially iOS, plus the `done`/JSON-mode change to the tutor call (test 1/3/12).
- **Do NOT touch:** audio capture/stitch (`segmentsRef`, `buildTeacherFile`, desktop-vs-iOS capture),
  grader/leniency, diag schema (ADD breadcrumbs only), Blob paths. Changes are confined to button gating
  + fencing in `VoiceQuiz.tsx`, and the `done`/retry in `quiz-turn` + wrap-up wording in `quiz-prompt.ts`.
- **Rollout:** one PR. Verify on a preview or a local phone with a real mic before pushing to `main`
  (auto-deploys). Only four students use the feature — a preview smoke test is cheap.
- **Prompt sync:** the `done` contract (JSON shape, or the sentinel + exact wrap-up phrase) lives in
  `lib/quiz-prompt.ts`; keep any marker out of anything spoken/shown.
- **Diagnostics continuity:** after v6, a saved `end:called` with `endReason="end-button"` should only
  ever appear at `phase=tutorTurn` with `tutorDone=true` — anything else there means the UI gate was
  bypassed (alert-worthy). An `end:called` with `endReason` starting `fail:` at a non-`tutorTurn` phase
  is **expected** (a failure/hang/backstop finalize), not suspicious.
```