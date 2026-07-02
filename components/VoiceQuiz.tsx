"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { useAuth } from "./AuthProvider";

type Turn = { role: "student" | "tutor"; text: string };

// One clip in the teacher's stitched recording, tagged with its position in the
// conversation (`order`) so the tutor's questions and the student's answers can
// be re-interleaved in the order they actually happened. Exactly one of
// blob/pcm is set: tutor lines and desktop answers carry a `blob` (mp3 /
// webm-mp4) decoded at the end; iOS answers carry ready-made 16 kHz `pcm`.
type AudioSegment = {
  order: number;
  kind: "tutor" | "student";
  blob?: Blob;
  pcm?: Float32Array;
};

// The graded report card the student sees at the end — the same shape the
// teacher reviews on /admin (minus the private transcript + recording).
type Report = {
  score?: string;
  summary?: string;
  strengths?: string[];
  gaps?: string[];
};

// A failure during the quiz (transcription / tutor unreachable). When one
// occurs, the session is saved as a PARTIAL attempt — the recording + transcript
// so far, flagged with this reason — instead of being lost. `detail` is a short
// human summary (the deep detail, incl. the student name, is logged server-side).
type SessionFailure = { reason: string; detail: string };

type Phase =
  | "idle" // modal closed
  | "needLogin" // clicked while logged out
  | "starting" // mic permission + first tutor question
  | "tutorTurn" // tutor's question is shown/spoken; waiting for the student to start
  | "recording" // student is recording their answer
  | "transcribing" // turning the recorded answer into text
  | "thinking" // generating the tutor's next line
  | "wrapup" // after "End quiz": one screen that fills in (upload → grade → score)
  | "error"; // a fatal startup problem (mic denied, first question failed)

// The state of one step in the post-quiz wrap-up checklist.
type StepState = "pending" | "active" | "done";

// How many bars the live recording meter shows (a short history of mic levels).
const METER_BARS = 24;

// Safety valve for a `done` signal that never fires. "End quiz" only appears once
// the tutor signals the quiz is complete, so if that signal never arrives the
// student could be trapped answering forever. If the transcript grows past this
// (a normal quiz is ~14 turns), we auto-save a partial and end. See stopSpeaking.
const MAX_TURNS = 24;

// A tutor-turn or transcribe fetch that hangs longer than this is treated as a
// failure → auto partial save + clean end. Since strict End-gating removes the
// manual escape hatch, this guarantees a stuck quiz still ends and saves.
const FETCH_TIMEOUT_MS = 60_000;

function StepIcon({ state }: { state: StepState }) {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
      {state === "done" ? (
        <span className="font-bold text-emerald-600">✓</span>
      ) : state === "active" ? (
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500" />
      ) : (
        <span className="h-2.5 w-2.5 rounded-full border border-stone-300" />
      )}
    </span>
  );
}

function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// A short random id. Used for the per-quiz `sessionId` and per-mount `mountId`
// stamped on every saved session (diagnostics): two saved records sharing a
// sessionId mean ONE quiz that saved twice; differing mountIds mean the
// component remounted between saves.
function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// The tutor's opening line. It's a fixed script (mirrors step 1 of
// `buildInstructions` in lib/quiz-prompt.ts — keep the two in sync), so we build
// it on the client and skip the tutor model call for the FIRST turn. That model
// call — a full chat completion with the whole article as context — is the single
// biggest startup delay; for a greeting we already know verbatim, it's pure
// waiting, so we skip it. The opening is also NOT spoken: it's the same every
// time and already on screen, so the student just reads it and presses Start
// speaking (only the tutor's dynamic follow-ups are spoken). Kept SHORT (just
// the task); the recording mechanics (Start speaking / Stop) are shown on screen
// under the button, not spoken (see RecordingHelp).
function openingLine(name: string | null): string {
  const who = (name ?? "").trim() || "there";
  return (
    `Hi ${who}. Explain the key ideas in the article, as much as you remember. ` +
    `Keep speaking and bring in as many layers as you can recall. Take as much ` +
    `time as you need — pauses and ums are all okay.`
  );
}

// The recording how-to, shown on screen under the Start speaking button (every
// turn) instead of being spoken — so the tutor's audio stays short. This is the
// "common instructions" that used to be part of the opening line.
function RecordingHelp() {
  return (
    <p className="mt-2.5 text-xs leading-relaxed text-stone-500">
      Press <span className="font-semibold text-stone-600">Start speaking</span> and
      wait until it shows <span className="font-semibold text-stone-600">Recording</span>{" "}
      before you talk. Press <span className="font-semibold text-stone-600">Stop</span>{" "}
      when you’ve finished your answer. The same steps apply to every question.
    </p>
  );
}

// ---- PCM → WAV helpers (the iOS recording path) --------------------------
// iOS Safari won't reliably record via MediaRecorder, so there we capture raw
// PCM through Web Audio and build a WAV ourselves. These run client-side only.

// The output sample rate for captured answers — 16 kHz mono is plenty for
// speech, keeps WAVs small (per-turn clips stay well under the upload limit),
// and is Whisper's native rate.
const WAV_RATE = 16000;

function mergeFloat32(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// Downsample mono PCM from inRate to outRate by simple block averaging.
function downsample(samples: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return samples;
  const ratio = inRate / outRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      sum += samples[j];
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

// Encode mono Float32 PCM as a 16-bit WAV Blob.
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// Decode any browser-playable audio Blob (the tutor's TTS mp3, or a desktop
// answer's webm/mp4) to mono 16 kHz PCM, so clips of different formats can be
// concatenated into one WAV. `ctx` is reused across clips.
async function decodeBlobToPcm16k(blob: Blob, ctx: AudioContext): Promise<Float32Array> {
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  let mono: Float32Array;
  if (buf.numberOfChannels === 1) {
    mono = buf.getChannelData(0);
  } else {
    mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < buf.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
    }
  }
  return downsample(mono, buf.sampleRate, WAV_RATE);
}

/**
 * The "Voice quiz" launcher in the home-page action bar. Shown to everyone
 * (logged in or not); the login check happens on click. Clicking it:
 *   - logged out → a small "You need to log in" popup;
 *   - logged in  → opens a modal and runs a TURN-BY-TURN oral quiz about that
 *     day's article.
 *
 * The flow is a discrete loop (no realtime speech-to-speech model):
 *   tutor line  → spoken with TTS (/api/quiz-tts) and shown on screen
 *   "Start speaking" → records the student's mic (state toggle, not push-to-hold)
 *   "Stop"       → transcribes the clip (/api/quiz-transcribe), shows it
 *   next line    → /api/quiz-turn returns the tutor's next question; repeat
 * Turn-taking is entirely the student's call (the buttons), never the model's.
 *
 * On "End quiz" the transcript is POSTed to /api/quiz-report, graded into a
 * report card, and saved to Blob for the teacher on /admin; the student is then
 * shown their full report card. The whole conversation — the tutor's spoken
 * questions AND the student's spoken answers — is stitched into ONE interleaved
 * WAV (in the order it happened), uploaded straight to Blob (via /api/quiz-audio's
 * token) and linked from the session for the teacher to play back. Recording is
 * best-effort — a failure never breaks the quiz.
 */
export default function VoiceQuiz({ date, title }: { date: string; title: string }) {
  // Login state comes from the shared AuthProvider (one /api/me fetch for the
  // whole page); login/logout both reload the page, so it stays fresh.
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  // A transient, non-fatal notice (e.g. "couldn't catch that — try again") shown
  // as a small banner in the live screen; cleared on the next action.
  const [notice, setNotice] = useState("");
  // The failure that ended this session (transcription / tutor unreachable). When
  // an error is hit we record it here and IMMEDIATELY end the quiz (failAndEnd),
  // saving a PARTIAL attempt with this reason — no button press required.
  // failureRef is the async-safe source of truth the save flow reads; `failed`
  // drives the wrap-up copy ("Saved — we hit a snag").
  const failureRef = useRef<SessionFailure | null>(null);
  const [failed, setFailed] = useState(false);

  // The on-screen conversation (tutor questions + the student's transcribed
  // answers). The student now sees their own answers, unlike the realtime build.
  const [turns, setTurns] = useState<Turn[]>([]);
  // Whether the tutor's TTS audio is currently playing (drives the speaker hint).
  const [ttsPlaying, setTtsPlaying] = useState(false);

  // Live recording UI: elapsed seconds + a short rolling history of mic levels.
  const [recSeconds, setRecSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => new Array(METER_BARS).fill(0));

  // The graded report card, shown to the student on the wrap-up screen.
  const [report, setReport] = useState<Report | null>(null);
  const [uploadStep, setUploadStep] = useState<StepState>("pending");
  const [gradeStep, setGradeStep] = useState<StepState>("pending");
  const [finished, setFinished] = useState(false);

  // The canonical transcript (refs avoid stale closures across async turns).
  const transcriptRef = useRef<Turn[]>([]);

  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);

  // ONE Web Audio graph owns the mic for the whole quiz: mic → source → (a)
  // analyser for the level meter and (b) a MediaStreamDestination we record. The
  // recorder records the graph's OUTPUT, not the raw mic track — recording the
  // raw track while an AudioContext is also reading the mic makes Chrome/macOS
  // capture silence (the 0-byte-clip bug). The graph is created once (on the
  // first answer, a user gesture) and reused across turns.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // A fresh recorder per turn (over the graph's destination stream), whose clip
  // we send to transcription AND drop into the audio timeline below.
  const turnRecRef = useRef<MediaRecorder | null>(null);
  const turnChunksRef = useRef<Blob[]>([]);

  // The ordered audio timeline for the teacher's recording: every tutor line
  // (its TTS mp3) and every student answer (desktop: the recorded webm/mp4 blob;
  // iOS: the captured 16 kHz PCM), each tagged with its position in the
  // conversation. At the end we sort by `order`, decode each clip to mono 16 kHz
  // PCM, concatenate, and encode ONE interleaved WAV — so the teacher hears the
  // tutor's questions and the student's answers in the order they happened.
  const segmentsRef = useRef<AudioSegment[]>([]);

  // iOS-only PCM capture (no MediaRecorder): a ScriptProcessor pulls raw samples
  // off a fresh mic each turn. iosSamplesRef accumulates the current turn.
  const iosCtxRef = useRef<AudioContext | null>(null);
  const iosMicRef = useRef<MediaStream | null>(null);
  const iosSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const iosProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const iosSamplesRef = useRef<Float32Array[]>([]);
  const iosRecordingRef = useRef(false);

  // Level meter animation + the elapsed-time timer.
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelsRef = useRef<number[]>(new Array(METER_BARS).fill(0));

  // The quiz ends only when the student clicks "End quiz" (once the tutor is done)
  // or an internal failure/hang/backstop finalizes it. This once-guard keeps the
  // save idempotent and lets cancel() block a racing finalize.
  const endStartedRef = useRef(false);

  // ---- Run/lifecycle fencing (so a stale async op can't mutate a newer quiz) --
  // Each quiz is one "run", identified by a generation token bumped on
  // start()/close()/unmount. Every async step captures its runId and, after each
  // await, bails if the run has moved on (Cancel/close/unmount) — otherwise a slow
  // transcribe/turn/TTS from an abandoned quiz could append/speak into a new one.
  const activeRunIdRef = useRef(0); // generation; bumped in start()/close()/unmount
  const endingRef = useRef(false); // this run is terminating (set at finalize/cancel)
  const mountedRef = useRef(true); // false after unmount
  const turnAbortRef = useRef<AbortController | null>(null); // quiz-turn + TTS fetches
  const transcribeAbortRef = useRef<AbortController | null>(null); // upload + transcribe

  // Set once the tutor signals the quiz is complete (`done` from /api/quiz-turn,
  // or the exact wrap-up phrase). ONLY then does "End quiz" appear and "Start
  // speaking" hide — so End can never fire mid-turn, the root of the data-loss bug.
  const [tutorDone, setTutorDone] = useState(false);

  // True while this run is the current, mounted one. False after Cancel/close (the
  // generation bumped) or unmount — the signal to discard a resolving async op.
  const isSameRun = (runId: number) =>
    activeRunIdRef.current === runId && mountedRef.current;
  // True while it's still safe to advance this run (same run AND not terminating).
  const canContinue = (runId: number) => isSameRun(runId) && !endingRef.current;

  // ---- Diagnostics (logging only; NO effect on the quiz) -----------------
  // The "one quiz saved as two records" bug is hard to reproduce, so every saved
  // session carries breadcrumbs that make the next occurrence self-explaining:
  //   sessionId — one id per quiz (per start()); two records with the SAME id ⇒
  //               one quiz that saved twice (the once-guard was bypassed).
  //   mountId   — one id per component mount; two records with DIFFERENT mountIds
  //               ⇒ the component remounted between the two saves.
  //   phaseRef  — the live phase, read at finalize time (a "fail:*" endReason at a
  //               non-tutorTurn phase is expected; "end-button" should only ever be
  //               at tutorTurn with the tutor done — anything else = a bypassed gate).
  //   breadcrumbs — an ordered event log (start, turns, transcribe, end:called…).
  const sessionIdRef = useRef<string | null>(null);
  const mountIdRef = useRef<string>("");
  const t0Ref = useRef<number>(0); // breadcrumb time origin (ms; set at mount)
  const endReasonRef = useRef<string>("");
  const phaseRef = useRef<Phase>("idle");
  const breadcrumbsRef = useRef<{ t: number; ev: string; info?: string }[]>([]);

  // iOS/WebKit needs the opposite recording path from desktop Chrome: it records
  // the RAW mic track fine but does NOT reliably record a Web Audio
  // MediaStreamDestination (which is the desktop workaround for a Chromium bug).
  // So we branch on platform. (All iOS browsers are WebKit under the hood.)
  const isIOS =
    typeof navigator !== "undefined" &&
    (/iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  function appendTurn(turn: Turn) {
    transcriptRef.current = [...transcriptRef.current, turn];
    setTurns(transcriptRef.current);
  }

  // Add one clip to the teacher's audio timeline (see segmentsRef).
  function pushSegment(seg: AudioSegment) {
    segmentsRef.current = [...segmentsRef.current, seg];
  }

  // Append one diagnostic breadcrumb (see the Diagnostics refs above). `t` is ms
  // since this mount; capped so a pathological loop can't grow it without bound.
  function logEvent(ev: string, info?: string) {
    const list = breadcrumbsRef.current;
    list.push({ t: Date.now() - t0Ref.current, ev, ...(info ? { info } : {}) });
    if (list.length > 500) breadcrumbsRef.current = list.slice(-400);
  }

  // Record a failure (its reason is what the teacher sees on the partial). Used
  // by failAndEnd; the latest one wins.
  function recordFailure(reason: string, detail: string) {
    failureRef.current = { reason, detail };
    setFailed(true);
  }

  // A genuine error/hang/backstop during the quiz (transcription rejected, tutor
  // unreachable, fetch timed out, runaway): record it and IMMEDIATELY finalize a
  // PARTIAL. finalizeQuiz reads failureRef, so the partial conversation (transcript
  // + recording so far) is saved automatically and the student lands on the wrap-up
  // screen — no button press. Unlike the user's End button, this is NOT gated on the
  // tutor being done — it saves whatever's captured, from any phase. (Soft "didn't
  // catch that" cases — no audio captured, or a blank transcript — are NOT errors:
  // they stay retry-able and never come here.)
  function failAndEnd(reason: string, detail: string) {
    recordFailure(reason, detail);
    void finalizeQuiz(`fail:${reason}`);
  }

  // Count the student's answers captured so far (used to label failures).
  function answersSoFar(): number {
    return transcriptRef.current.filter((t) => t.role === "student").length;
  }

  // Pick a container the browser can record (Chrome/Firefox: webm/opus; Safari:
  // mp4). Undefined → let MediaRecorder choose its default.
  function pickRecorderMime(): { mimeType: string } | undefined {
    if (typeof MediaRecorder === "undefined") return undefined;
    for (const mimeType of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
      if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType };
    }
    return undefined;
  }

  // ---- Tutor speech (TTS) -------------------------------------------------

  function stopTts() {
    const el = audioElRef.current;
    if (el) {
      el.onended = null;
      try {
        el.pause();
      } catch {
        // ignore
      }
      el.removeAttribute("src");
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    setTtsPlaying(false);
  }

  // Speak the tutor's line. Best-effort: if TTS fails, the line is still on
  // screen, so the quiz simply continues silently for that turn. `order` is the
  // line's position in the conversation — we drop its mp3 into the audio timeline
  // so the teacher's recording includes the tutor's questions, in sequence.
  async function speak(text: string, order: number, runId: number) {
    stopTts();
    setTtsPlaying(true);
    // Capture the run's abort controller ONCE (never re-read after an await); a
    // finalize/cancel aborts it to cut off a trailing wrap-up TTS.
    const turnAbort = turnAbortRef.current;
    try {
      const res = await fetch("/api/quiz-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: turnAbort?.signal,
      });
      if (!res.ok) throw new Error("tts");
      const blob = await res.blob();
      // The quiz ended (End/Cancel/unmount) while the TTS was in flight — don't add
      // a late segment or start audio after teardown.
      if (!canContinue(runId)) {
        setTtsPlaying(false);
        return;
      }
      pushSegment({ order, kind: "tutor", blob });
      const url = URL.createObjectURL(blob);
      ttsUrlRef.current = url;
      const el = audioElRef.current;
      if (!el) {
        setTtsPlaying(false);
        return;
      }
      el.src = url;
      el.onended = () => setTtsPlaying(false);
      await el.play().catch(() => setTtsPlaying(false));
    } catch {
      setTtsPlaying(false);
    }
  }

  // ---- Tutor turns (the loop) --------------------------------------------

  // Ask the server for the tutor's next line, given the transcript so far, then
  // show + speak it. `first` is the opening greeting/question. `runId` fences the
  // async work so a stale turn can't resurrect an ended quiz.
  async function nextTutorTurn(first: boolean, runId: number) {
    setNotice("");
    setPhase(first ? "starting" : "thinking");
    logEvent(first ? "tutor-turn:first" : "tutor-turn:begin");

    // FIRST turn: skip the tutor model entirely AND don't speak it. The opening
    // is a fixed script (see openingLine), shown on screen and identical every
    // time, so the student just reads it and presses Start speaking — there's
    // nothing dynamic to hear. Skipping its TTS also removes the last bit of
    // startup latency (mic permission is now the only wait). Only the tutor's
    // later, dynamic follow-ups are spoken (below).
    if (first) {
      appendTurn({ role: "tutor", text: openingLine(user) });
      setPhase("tutorTurn");
      return;
    }

    // Capture the run's abort controller once. A timeout (a genuine hang) aborts
    // it too, so we track `timedOut` to tell that apart from a Cancel/finalize.
    const turnAbort = turnAbortRef.current;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      turnAbort?.abort();
    }, FETCH_TIMEOUT_MS);
    try {
      const res = await fetch("/api/quiz-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, studentName: user, transcript: transcriptRef.current }),
        signal: turnAbort?.signal,
      });
      clearTimeout(timeout);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.text) {
        throw new Error(data?.error ?? "Could not get the next question.");
      }
      // The quiz ended/was cancelled while this turn was in flight — discard it.
      if (!canContinue(runId)) return;
      appendTurn({ role: "tutor", text: data.text });
      // The index of the tutor line we just added — its slot in the timeline.
      const order = transcriptRef.current.length - 1;
      const done = data.done === true;
      logEvent("tutor-turn:ok", `idx=${order} done=${done}`);
      // The tutor wrapped up → reveal "End quiz", hide "Start speaking".
      if (done) setTutorDone(true);
      setPhase("tutorTurn");
      void speak(data.text, order, runId);
    } catch (err) {
      clearTimeout(timeout);
      // Cancelled/ended/unmounted while awaiting → silently discard (not a failure).
      if (!canContinue(runId)) return;
      const n = answersSoFar();
      if (timedOut) {
        logEvent("tutor-turn:fail", "timeout");
        failAndEnd(
          "tutor-timeout",
          `The tutor didn't respond in time after ${n} answer${n === 1 ? "" : "s"}.`
        );
      } else {
        // A mid-quiz turn failed (the first turn can't reach here; it never makes a
        // network call). Save the partial and end automatically rather than
        // stranding the student on a retry screen.
        logEvent("tutor-turn:fail", (err as Error)?.name);
        failAndEnd(
          "tutor-unreachable",
          `Couldn't load the next question after ${n} answer${n === 1 ? "" : "s"}.`
        );
      }
    }
  }

  // ---- Recording one answer ----------------------------------------------

  // Build the single mic-owning graph (once per quiz). Returns the destination
  // stream the recorder records, or null if audio setup failed.
  async function ensureAudioGraph(): Promise<MediaStream | null> {
    const mic = micRef.current;
    if (!mic) return null;
    if (destRef.current) return destRef.current.stream;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    audioCtxRef.current = ctx;
    // A fresh context can be "suspended"; resume so audio actually flows.
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createMediaStreamSource(mic);
    micSourceRef.current = source;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;
    const dest = ctx.createMediaStreamDestination();
    source.connect(dest); // the recorder records THIS, fed by the mic via the graph
    destRef.current = dest;
    return dest.stream;
  }

  function startMeterLoop() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      // RMS of the waveform around the 128 midpoint → a 0..1 loudness level.
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, rms * 4); // scale up — speech rarely maxes RMS
      const next = [...levelsRef.current.slice(1), level];
      levelsRef.current = next;
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopMeterLoop() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    levelsRef.current = new Array(METER_BARS).fill(0);
    setLevels(levelsRef.current);
  }

  // iOS: begin capturing PCM for one answer. We acquire a FRESH mic each turn —
  // iOS tends to mute a long-lived getUserMedia track after the tutor's audio
  // plays through the <audio> element, so re-acquiring guarantees a live capture
  // session. A ScriptProcessor copies samples; the analyser drives the meter.
  async function iosStartCapture() {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    iosMicRef.current = mic;
    let ctx = iosCtxRef.current;
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor!();
      iosCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") await ctx.resume();

    const source = ctx.createMediaStreamSource(mic);
    iosSourceRef.current = source;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    iosSamplesRef.current = [];
    iosRecordingRef.current = true;
    processor.onaudioprocess = (e) => {
      if (!iosRecordingRef.current) return;
      // Copy — the input buffer is reused across callbacks.
      iosSamplesRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      // Silence the output so routing to destination (which the processor needs
      // to actually run) doesn't echo the mic back to the speakers.
      e.outputBuffer.getChannelData(0).fill(0);
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    iosProcessorRef.current = processor;
  }

  // iOS: stop capturing, tear down the per-turn graph + mic, and return the
  // answer as a 16 kHz WAV (plus the PCM, kept for the teacher's stitched file).
  function iosStopCapture(): { blob: Blob; filename: string; pcm: Float32Array } | null {
    iosRecordingRef.current = false;
    const ctx = iosCtxRef.current;
    const processor = iosProcessorRef.current;
    iosProcessorRef.current = null;
    if (processor) {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {
        // ignore
      }
    }
    iosSourceRef.current?.disconnect();
    iosSourceRef.current = null;
    iosMicRef.current?.getTracks().forEach((t) => t.stop());
    iosMicRef.current = null;

    const chunks = iosSamplesRef.current;
    iosSamplesRef.current = [];
    if (!chunks.length) return null;
    const pcm = downsample(mergeFloat32(chunks), ctx?.sampleRate ?? 48000, WAV_RATE);
    if (!pcm.length) return null;
    return { blob: encodeWav(pcm, WAV_RATE), filename: "answer.wav", pcm };
  }

  // Abandon a just-(or partially-)built iOS capture graph: stop the mic/processor
  // AND close the context. Needed when the run ends while iosStartCapture is
  // mid-await — the teardown() that ran then couldn't see these refs (they're
  // assigned after its awaits), so without this the mic stays hot and the leaked
  // processor keeps accumulating samples — and after a failed start, so nothing
  // half-built lingers holding the mic.
  function iosAbandonCapture() {
    iosStopCapture();
    iosCtxRef.current?.close().catch(() => {});
    iosCtxRef.current = null;
  }

  // "Start speaking" — a state toggle (no press-and-hold). Begins recording the
  // student's answer off the Web Audio graph; the live meter + timer make it
  // obvious the mic is hot.
  async function startSpeaking() {
    // No new answers once the tutor is done (End quiz is the only next step).
    if (phase !== "tutorTurn" || tutorDone) return;
    const runId = activeRunIdRef.current;
    setNotice("");
    stopTts(); // if the tutor is still talking, the student is taking over
    // iOS records via raw-PCM capture (MediaRecorder is unreliable there);
    // desktop records the Web Audio graph's output with MediaRecorder.
    if (isIOS) {
      try {
        await iosStartCapture();
      } catch (err) {
        console.warn("[voicequiz] iOS capture failed", err);
        iosAbandonCapture(); // release whatever was partially built (mic may be live)
        if (!canContinue(runId)) return;
        setNotice("Couldn't start the microphone. Please allow mic access and try again.");
        return;
      }
      // The run ended (Cancel/close/unmount) while the mic was being acquired.
      // That teardown() ran BEFORE iosStartCapture assigned its refs, so it
      // couldn't stop this graph — abandon it here or the mic stays hot (and the
      // leaked processor keeps feeding samples) after a discarded quiz.
      if (!canContinue(runId)) {
        iosAbandonCapture();
        return;
      }
    } else {
      const mic = micRef.current;
      if (!mic) return;
      let graph: MediaStream | null = null;
      try {
        graph = await ensureAudioGraph();
      } catch (err) {
        console.warn("[voicequiz] audio graph failed", err);
      }
      // The run ended while the graph was being set up (that teardown stopped the
      // mic and closed the context) — bail before building a recorder on it.
      if (!canContinue(runId)) return;
      if (!graph) {
        setNotice("Couldn't start audio. Please check microphone access and try again.");
        return;
      }
      // The per-turn recorder. A timeslice makes data flush as it's captured.
      try {
        const rec = new MediaRecorder(graph, pickRecorderMime());
        turnChunksRef.current = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) turnChunksRef.current.push(e.data);
        };
        rec.start(250);
        turnRecRef.current = rec;
      } catch {
        setNotice("Couldn't start recording. Please check microphone access.");
        return;
      }
    }

    setRecSeconds(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    startMeterLoop();
    logEvent("start-speaking", `order=${transcriptRef.current.length} ios=${isIOS}`);
    setPhase("recording");
  }

  // Stop the per-turn recorder and resolve its audio Blob (+ a filename the STT
  // route can key the format off).
  function stopTurnRecorder(): Promise<{ blob: Blob; filename: string } | null> {
    const rec = turnRecRef.current;
    turnRecRef.current = null;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const chunks = turnChunksRef.current;
        turnChunksRef.current = [];
        if (!chunks.length) return resolve(null);
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
        resolve({ blob: new Blob(chunks, { type }), filename: `answer.${ext}` });
      };
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }

  // "Stop" — finish the answer: stop the recorder, transcribe the clip, show it,
  // then ask for the tutor's next line. `runId` fences the async work so a stale
  // answer can't append into an ended/cancelled quiz.
  async function stopSpeaking() {
    if (phase !== "recording") return;
    const runId = activeRunIdRef.current;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopMeterLoop();
    logEvent("stop-speaking", `order=${transcriptRef.current.length} ios=${isIOS}`);

    // Collect this answer's clip (iOS: a WAV + its PCM from PCM capture; desktop:
    // the recorder's webm/mp4) and drop it into the teacher's audio timeline at
    // the slot this answer will occupy (right after the tutor line above it).
    const studentOrder = transcriptRef.current.length;
    let turn: { blob: Blob; filename: string } | null;
    if (isIOS) {
      const cap = iosStopCapture();
      if (cap) {
        pushSegment({ order: studentOrder, kind: "student", pcm: cap.pcm });
        turn = { blob: cap.blob, filename: cap.filename };
      } else {
        turn = null;
      }
    } else {
      turn = await stopTurnRecorder();
      // Cancelled/ended/unmounted while the recorder was closing out — this
      // answer belongs to a dead run; don't push its clip or advance the gone UI.
      if (!canContinue(runId)) return;
      if (turn) pushSegment({ order: studentOrder, kind: "student", blob: turn.blob });
    }
    if (!turn) {
      logEvent("stop:no-audio");
      setNotice("I didn't catch any audio. Tap Start speaking to try again.");
      setPhase("tutorTurn");
      return;
    }

    setPhase("transcribing");
    logEvent("transcribe:begin");
    // A genuine hang becomes a failure → auto partial save. Two separate budgets:
    // the upload leg is scaled to the clip size (iOS answers are uncompressed
    // WAVs, ~2MB/min, and a slow uplink can legitimately need well over 60s —
    // slow-but-progressing is not a hang), then the transcribe fetch gets a fresh
    // standard budget. `timedOut` tells a real timeout from a Cancel/finalize.
    const transcribeAbort = transcribeAbortRef.current;
    let timedOut = false;
    const armTimeout = (ms: number) =>
      setTimeout(() => {
        timedOut = true;
        transcribeAbort?.abort();
      }, ms);
    // 60s + ~30s per MB of clip, capped at 5 minutes.
    let timeout = armTimeout(
      Math.min(300_000, FETCH_TIMEOUT_MS + Math.round((turn.blob.size / 1_000_000) * 30_000))
    );
    try {
      // Upload the answer clip straight to Blob, then transcribe it from there.
      // Routing the bytes through /api/quiz-transcribe hit Vercel's ~4.5MB
      // request-body limit — a long answer 413'd before the function even ran —
      // so we use the same direct-to-Blob upload() flow as the teacher recording
      // (its token route, /api/quiz-audio, allows these per-turn paths too).
      const ext = turn.filename.split(".").pop() || "webm";
      const contentType =
        ext === "wav"
          ? "audio/wav"
          : ext === "mp4"
            ? "audio/mp4"
            : ext === "ogg"
              ? "audio/ogg"
              : "audio/webm";
      const safeName = (user ?? "student").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
      const uploaded = await upload(
        `quiz-sessions/${date}/turns/${safeName}-${studentOrder}.${ext}`,
        turn.blob,
        {
          access: "public",
          handleUploadUrl: "/api/quiz-audio",
          contentType,
          clientPayload: JSON.stringify({ date }),
          abortSignal: transcribeAbort?.signal,
        }
      );
      clearTimeout(timeout);
      // Cancelled/ended/unmounted during the upload — discard silently.
      if (!canContinue(runId)) return;
      // Fresh budget for the transcribe call itself.
      timeout = armTimeout(FETCH_TIMEOUT_MS);
      const res = await fetch("/api/quiz-transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, blobUrl: uploaded.url }),
        signal: transcribeAbort?.signal,
      });
      clearTimeout(timeout);
      const data = await res.json().catch(() => null);
      // Cancelled/ended while the transcribe was in flight — discard silently.
      if (!canContinue(runId)) return;
      if (!res.ok) {
        // The clip recorded fine (it's already in the teacher's timeline) but
        // OpenAI rejected it. Save the partial and end automatically — the
        // student doesn't have to press anything to keep their work.
        logEvent("transcribe:http-fail", `status=${res.status}`);
        failAndEnd(
          "transcription-failed",
          `Couldn't transcribe answer ${answersSoFar() + 1} (server returned ${res.status}).`
        );
        return;
      }
      const text = (data?.text ?? "").trim();
      if (!text) {
        logEvent("transcribe:empty");
        setNotice("I didn't catch any words — speak a bit louder/closer and tap Start speaking to try again.");
        setPhase("tutorTurn");
        return;
      }
      appendTurn({ role: "student", text });
      logEvent("transcribe:ok", `chars=${text.length} sTurns=${answersSoFar()}`);
      // Runaway backstop: the tutor never signalled `done` and the transcript has
      // grown unreasonably long. Auto-save a partial and end rather than trapping
      // the student answering forever (End quiz is gated on `done`, §5 of the plan).
      if (transcriptRef.current.length >= MAX_TURNS) {
        logEvent("backstop:max-turns", `turns=${transcriptRef.current.length}`);
        failAndEnd(
          "quiz-runaway",
          "The quiz ran unusually long without wrapping up, so we saved what we have."
        );
        return;
      }
      await nextTutorTurn(false, runId);
    } catch (err) {
      clearTimeout(timeout);
      // Cancelled/ended/unmounted while awaiting → silently discard (not a failure).
      if (!canContinue(runId)) return;
      console.warn("[voicequiz] transcribe failed", err);
      if (timedOut) {
        logEvent("transcribe:error", "timeout");
        failAndEnd(
          "transcription-timeout",
          `Transcribing answer ${answersSoFar() + 1} timed out.`
        );
      } else {
        // Covers a failed Blob upload as well as a network error reaching the
        // transcriber — either way it's a genuine error, so save + end.
        logEvent("transcribe:error", (err as Error)?.name);
        failAndEnd(
          "transcription-error",
          `Network error transcribing answer ${answersSoFar() + 1}.`
        );
      }
    }
  }

  // ---- Teardown ------------------------------------------------------------

  // The teacher's recording: the whole conversation — the tutor's questions AND
  // the student's answers — stitched into ONE interleaved WAV, in the order it
  // happened. We sort the timeline by position, decode every clip (tutor mp3 +
  // desktop answer webm; iOS answers are already 16 kHz PCM) to mono 16 kHz,
  // concatenate, and encode a single seekable WAV. Best-effort: a clip that
  // won't decode is skipped rather than failing the whole recording.
  async function buildTeacherFile(): Promise<{ blob: Blob; ext: string; durationMs: number } | null> {
    const segments = [...segmentsRef.current].sort((a, b) => a.order - b.order);
    if (!segments.length) return null;
    let ctx: AudioContext | null = null;
    const pcms: Float32Array[] = [];
    for (const seg of segments) {
      if (seg.pcm && seg.pcm.length) {
        pcms.push(seg.pcm);
        continue;
      }
      if (!seg.blob || seg.blob.size === 0) continue;
      if (!ctx) {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) break;
        ctx = new Ctor();
      }
      try {
        pcms.push(await decodeBlobToPcm16k(seg.blob, ctx));
      } catch (err) {
        console.warn("[voicequiz] couldn't decode an audio segment", err);
      }
    }
    ctx?.close().catch(() => {});
    const merged = mergeFloat32(pcms.filter((p) => p.length));
    if (!merged.length) return null;
    // The recording's length (total talk time: tutor questions + answers). This
    // is the same "duration" the teacher/student sees in the playback control,
    // saved as the session's durationMs and shown in the Scores table.
    const durationMs = Math.round((merged.length / WAV_RATE) * 1000);
    return { blob: encodeWav(merged, WAV_RATE), ext: "wav", durationMs };
  }

  function teardown() {
    stopTts();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopMeterLoop();
    const rec = turnRecRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    turnRecRef.current = null;
    turnChunksRef.current = [];
    // Tear down the desktop Web Audio graph.
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
    destRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    // Tear down the iOS PCM-capture graph.
    iosRecordingRef.current = false;
    if (iosProcessorRef.current) {
      iosProcessorRef.current.onaudioprocess = null;
      try {
        iosProcessorRef.current.disconnect();
      } catch {
        // ignore
      }
      iosProcessorRef.current = null;
    }
    iosSourceRef.current?.disconnect();
    iosSourceRef.current = null;
    iosMicRef.current?.getTracks().forEach((t) => t.stop());
    iosMicRef.current = null;
    iosCtxRef.current?.close().catch(() => {});
    iosCtxRef.current = null;
    iosSamplesRef.current = [];
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
  }

  // ---- Start / end / cancel / close --------------------------------------

  async function start() {
    setError("");
    setNotice("");
    setReport(null);
    setUploadStep("pending");
    setGradeStep("pending");
    setFinished(false);
    setTurns([]);
    transcriptRef.current = [];
    segmentsRef.current = [];
    failureRef.current = null;
    setFailed(false);
    endStartedRef.current = false;
    // A new run: bump the generation so any straggler from a prior quiz is fenced
    // out, clear the terminating flag + the done gate, and arm fresh abort
    // controllers for this run's fetches.
    const runId = (activeRunIdRef.current += 1);
    endingRef.current = false;
    setTutorDone(false);
    turnAbortRef.current = new AbortController();
    transcribeAbortRef.current = new AbortController();
    // Fresh diagnostics for this quiz (mountId/t0 persist for the whole mount).
    sessionIdRef.current = newId();
    endReasonRef.current = "";
    breadcrumbsRef.current = [];
    logEvent("start", `session=${sessionIdRef.current} mount=${mountIdRef.current} ios=${isIOS}`);
    setPhase("starting");

    try {
      // Mic permission — this click is the user gesture that also lets audio play.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Cancelled/closed/unmounted during the permission prompt — release + bail.
      if (!isSameRun(runId)) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      // iOS re-acquires a fresh mic for each answer (a long-lived track gets
      // muted after the tutor's audio plays), so we only need this to prompt for
      // permission up front — release it immediately. Desktop keeps it.
      if (isIOS) {
        mic.getTracks().forEach((t) => t.stop());
        micRef.current = null;
      } else {
        micRef.current = mic;
      }
    } catch {
      if (!isSameRun(runId)) return;
      setError("Microphone access is needed for the voice quiz. Please allow it and try again.");
      setPhase("error");
      return;
    }
    await nextTutorTurn(true, runId);
  }

  // The button click — preserves the user gesture (no awaits before start()).
  function launch() {
    if (!user) {
      setPhase("needLogin");
      return;
    }
    start();
  }

  // The student's "End quiz" button. Allowed ONLY at the true end — once the tutor
  // has signalled the quiz is done. The UI hides End otherwise (Start speaking is
  // shown instead), and this guard makes that structural: End can never fire
  // mid-turn, which is what made the old end()-races-the-loop data loss possible.
  function userEnd() {
    if (phase !== "tutorTurn" || !tutorDone) return;
    void finalizeQuiz("end-button");
  }

  // The single, once-guarded save/teardown path. Reached by userEnd (gated) and
  // failAndEnd (an internal failure/hang/backstop, any phase). `reason` becomes
  // the saved endReason and tells the two apart in diagnostics. Because End can't
  // fire mid-turn and an internal finalize just saves whatever's captured, there
  // is no in-flight turn to reconcile here — no recorder closeout, no settle.
  async function finalizeQuiz(reason: string) {
    endReasonRef.current = reason;
    // Diagnostics: record EVERY finalize attempt with the live phase + guard state
    // BEFORE the once-guard can bail. If the "saved twice" bug recurs we'll see
    // whether a 2nd finalize was blocked (guard worked) or proceeded (guard
    // failed). An end:called at phase=tutorTurn with reason=end-button is expected;
    // a reason starting "fail:" is valid at ANY phase (failure/hang/backstop).
    const phaseAtEnd = phaseRef.current;
    logEvent(
      "end:called",
      `phase=${phaseAtEnd} guard=${endStartedRef.current} reason=${reason} ` +
        `sTurns=${answersSoFar()} turns=${transcriptRef.current.length} segs=${segmentsRef.current.length}`
    );
    if (endStartedRef.current) {
      logEvent("end:blocked");
      return; // ignore a double-click / racing finalize — run once
    }
    endStartedRef.current = true;
    endingRef.current = true;
    // Cut off a trailing wrap-up TTS (or any straggling turn/transcribe) so nothing
    // resolves back into the quiz after we start saving.
    turnAbortRef.current?.abort();
    transcribeAbortRef.current?.abort();
    setNotice("");
    setReport(null);
    setUploadStep("pending");
    setGradeStep("pending");
    setFinished(false);
    setPhase("wrapup");

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopMeterLoop();
    const session = await buildTeacherFile();
    // The recording's length — saved as the session's duration (shown in the
    // Scores table). undefined when nothing was recorded → table shows "—".
    const durationMs = session?.durationMs;
    teardown();

    // 1. Upload the stitched recording (best-effort) — straight from the browser
    // to Blob via the client upload() flow, so the bytes skip our function and
    // its ~4.5MB request-body limit.
    let audioUrl: string | undefined;
    setUploadStep("active");
    if (session && session.blob.size > 0) {
      try {
        const safeName = (user ?? "student").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
        const contentType =
          session.ext === "wav"
            ? "audio/wav"
            : session.ext === "mp4"
              ? "audio/mp4"
              : session.ext === "ogg"
                ? "audio/ogg"
                : "audio/webm";
        const blob = await upload(
          `quiz-sessions/${date}/${safeName}.${session.ext}`,
          session.blob,
          {
            access: "public",
            handleUploadUrl: "/api/quiz-audio",
            contentType,
            clientPayload: JSON.stringify({ date }),
          }
        );
        audioUrl = blob.url;
      } catch {
        // No recording link — the transcript + report still save below.
      }
    }
    setUploadStep("done");

    // 2. Grade + save (transcript + report card + audio link) for the teacher,
    // and show the student their full report card. If a failure occurred this
    // session, mark it a PARTIAL attempt and pass the reason — the server stores
    // it and logs it with the student's name + how far they got.
    const failure = failureRef.current;
    const partial = !!failure;
    setGradeStep("active");
    logEvent("save:begin", `audio=${!!audioUrl} dur=${durationMs ?? "-"} partial=${partial}`);
    try {
      const res = await fetch("/api/quiz-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          studentName: user,
          transcript: transcriptRef.current,
          audioUrl,
          durationMs,
          partial,
          failure,
          // Diagnostics (see the Diagnostics refs) — attached to the saved record.
          sessionId: sessionIdRef.current,
          mountId: mountIdRef.current,
          endReason: reason,
          phaseAtEnd,
          breadcrumbs: breadcrumbsRef.current,
        }),
      });
      logEvent("save:done", `status=${res.status}`);
      const data = await res.json().catch(() => null);
      if (data?.report) setReport(data.report as Report);
    } catch {
      // The session still happened; saving is best-effort.
      logEvent("save:error");
    } finally {
      setGradeStep("done");
      setFinished(true);
    }
  }

  // "Cancel quiz" — bail out with NOTHING saved (no recording, no transcript, no
  // session). Errors now auto-save a partial and end on their own (failAndEnd),
  // so reaching this button always means a deliberate, clean discard. The
  // once-guard also blocks a late end() from a double-click race.
  // Cancel throws away the whole session, so the button confirms first. (While
  // the native dialog is open JS is paused, so an in-flight turn can't advance
  // underneath it; on OK, cancel() runs before any queued continuation and the
  // fences discard them.)
  function confirmCancel() {
    if (!confirm("Cancel this quiz? Nothing will be saved — your answers so far will be lost.")) {
      return;
    }
    cancel();
  }

  function cancel() {
    endReasonRef.current = "cancel";
    logEvent("cancel");
    // Mark the run terminating + spent so a straggling async op discards, and a
    // racing finalize is blocked by the once-guard. Abort in-flight fetches too.
    endingRef.current = true;
    endStartedRef.current = true;
    turnAbortRef.current?.abort();
    transcribeAbortRef.current?.abort();
    close();
  }

  function close() {
    // New generation → fence any straggler still resolving from this run; clear
    // the terminating flag + the done gate so the next quiz starts clean.
    activeRunIdRef.current += 1;
    endingRef.current = false;
    setTutorDone(false);
    teardown();
    setPhase("idle");
    setError("");
    setNotice("");
    setReport(null);
    setUploadStep("pending");
    setGradeStep("pending");
    setFinished(false);
    setTurns([]);
    transcriptRef.current = [];
    segmentsRef.current = [];
    failureRef.current = null;
    setFailed(false);
    endStartedRef.current = false;
  }

  // Assign this mount's id + breadcrumb time origin (diagnostics), and stop the
  // mic/recorders if the component unmounts mid-session.
  useEffect(() => {
    // Restore on every effect run: dev StrictMode runs mount → cleanup → mount on
    // the same component, and the cleanup below sets this false — without this
    // line isSameRun() would stay false forever in dev and every fence would
    // bail (the quiz would hang at "Starting…").
    mountedRef.current = true;
    mountIdRef.current = newId();
    t0Ref.current = Date.now();
    return () => {
      // Fence every in-flight async op against this mount, abort pending fetches,
      // and release the mic/recorders.
      mountedRef.current = false;
      activeRunIdRef.current += 1;
      turnAbortRef.current?.abort();
      transcribeAbortRef.current?.abort();
      teardown();
    };
  }, []);

  // Mirror the live phase into a ref so finalizeQuiz can read the true current
  // phase (for diagnostics) without a stale closure.
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Keep the conversation log scrolled to the newest turn.
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, phase]);

  const modalOpen = phase !== "idle";
  // A stray backdrop click shouldn't drop a live quiz or interrupt the wrap-up
  // while it's still saving — only allow close when nothing's in flight.
  const dismissable =
    phase === "needLogin" || phase === "error" || (phase === "wrapup" && finished);
  const live =
    phase === "tutorTurn" ||
    phase === "recording" ||
    phase === "transcribing" ||
    phase === "thinking";

  return (
    <>
      {/* Styled as a text link so it sits inline in the home-page action bar. */}
      <button
        type="button"
        onClick={launch}
        className="font-medium text-sky-700 transition hover:text-sky-900 hover:underline"
      >
        Voice quiz
      </button>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
          onClick={() => {
            if (dismissable) close();
          }}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <audio ref={audioElRef} className="hidden" />

            {phase === "needLogin" && (
              <div>
                <h2 className="font-serif text-xl font-bold text-stone-900">
                  You need to log in
                </h2>
                <p className="mt-2 text-sm text-stone-600">
                  Please log in first (the “Log in” button at the top right), then
                  start the voice quiz.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="mt-5 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
                >
                  Close
                </button>
              </div>
            )}

            {phase === "starting" && (
              <div>
                <h2 className="font-serif text-xl font-bold text-stone-900">
                  Starting your voice quiz…
                </h2>
                <p className="mt-2 text-sm text-stone-500">
                  Please allow microphone access when your browser asks.
                </p>
              </div>
            )}

            {live && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-serif text-lg font-bold text-stone-900">
                    Voice quiz — {title}
                  </h2>
                </div>
                <p className="mt-1 text-xs text-stone-400">
                  Your answers are recorded and saved for your teacher.
                </p>

                {/* The running conversation: tutor questions + your answers. */}
                <div
                  ref={logRef}
                  className="mt-4 min-h-[8rem] flex-1 space-y-3 overflow-y-auto rounded-xl bg-stone-50 p-4"
                >
                  {turns.map((t, i) => (
                    <div key={i}>
                      <p
                        className={
                          t.role === "tutor"
                            ? "text-xs font-semibold uppercase tracking-wide text-sky-600"
                            : "text-xs font-semibold uppercase tracking-wide text-stone-500"
                        }
                      >
                        {t.role === "tutor" ? "Tutor" : "You"}
                      </p>
                      <p className="text-sm text-stone-700">{t.text}</p>
                    </div>
                  ))}
                  {turns.length === 0 && (
                    <p className="text-sm text-stone-400">Your tutor is getting ready…</p>
                  )}
                </div>

                {notice && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {notice}
                  </p>
                )}

                {/* Status + controls, by phase. */}
                <div className="mt-4">
                  {phase === "tutorTurn" && (
                    <>
                      {ttsPlaying && (
                        <p className="mb-3 flex items-center gap-2 text-sm text-sky-700">
                          <span className="flex gap-0.5" aria-hidden>
                            <span className="h-3 w-1 animate-pulse rounded-full bg-sky-500" />
                            <span className="h-4 w-1 animate-pulse rounded-full bg-sky-500 [animation-delay:120ms]" />
                            <span className="h-3 w-1 animate-pulse rounded-full bg-sky-500 [animation-delay:240ms]" />
                          </span>
                          Tutor is speaking…
                        </p>
                      )}
                      {/* Until the tutor signals it's done, the only move is to
                          answer. Once done, Start speaking hides and the End quiz
                          button (below) is the way to finish. */}
                      {!tutorDone ? (
                        <>
                          <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={startSpeaking}
                              className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
                            >
                              🎙 Start speaking
                            </button>
                          </div>
                          <RecordingHelp />
                        </>
                      ) : (
                        <p className="text-sm text-stone-600">
                          You’re all done — press{" "}
                          <span className="font-semibold text-emerald-700">End quiz</span>{" "}
                          to finish and see your report.
                        </p>
                      )}
                    </>
                  )}

                  {phase === "recording" && (
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="flex h-3 w-3 animate-pulse rounded-full bg-red-500" />
                        <span className="text-sm font-semibold text-red-600">
                          Recording — {fmtClock(recSeconds)}
                        </span>
                      </div>
                      {/* Live mic-level meter — an unmistakable "you're being
                          recorded right now" cue (driven by the analyser on both
                          the desktop and iOS capture paths). */}
                      <div className="mt-3 flex h-10 items-center gap-0.5">
                        {levels.map((lvl, i) => (
                          <span
                            key={i}
                            className="w-1 rounded-full bg-red-400"
                            style={{ height: `${Math.max(8, lvl * 100)}%` }}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={stopSpeaking}
                        className="mt-4 rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700"
                      >
                        ⏹ Stop
                      </button>
                    </div>
                  )}

                  {phase === "transcribing" && (
                    <p className="flex items-center gap-2 text-sm text-stone-500">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500" />
                      Transcribing your answer…
                    </p>
                  )}

                  {phase === "thinking" && (
                    <p className="flex items-center gap-2 text-sm text-stone-500">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500" />
                      Thinking about your next question…
                    </p>
                  )}
                </div>

                {/* End quiz appears ONLY once the tutor has wrapped up (tutorDone),
                    so it can never truncate an in-flight turn. Cancel (a clean
                    discard) is always available as the way to stop early. */}
                <div className="mt-5 flex items-center gap-3 border-t border-stone-100 pt-4">
                  {phase === "tutorTurn" && tutorDone && (
                    <button
                      type="button"
                      onClick={userEnd}
                      className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      End quiz
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={confirmCancel}
                    className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
                  >
                    Cancel quiz
                  </button>
                </div>
              </div>
            )}

            {/* One stable screen after End quiz — the checklist fills in place
                (upload → grade → score) so nothing flashes by, and Close stays
                disabled until everything has saved. */}
            {phase === "wrapup" && (
              <div className="flex min-h-0 flex-col">
                <h2 className="font-serif text-xl font-bold text-stone-900">
                  {finished
                    ? failed
                      ? "Saved — we hit a snag"
                      : "All done — nice work!"
                    : "Wrapping up…"}
                </h2>
                <ul className="mt-4 space-y-2.5 text-sm">
                  <li className="flex items-center gap-2.5">
                    <StepIcon state={uploadStep} />
                    <span className={uploadStep === "pending" ? "text-stone-400" : "text-stone-700"}>
                      Uploading your recording
                    </span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <StepIcon state={gradeStep} />
                    <span className={gradeStep === "pending" ? "text-stone-400" : "text-stone-700"}>
                      Grading your quiz
                    </span>
                  </li>
                </ul>

                {finished && (
                  <div className="mt-4 max-h-[55vh] overflow-y-auto border-t border-stone-100 pt-4">
                    {report?.score && report.score !== "—" && (
                      <p className="text-sm text-stone-600">
                        You scored{" "}
                        <span className="text-lg font-bold text-sky-700">{report.score}</span>.
                      </p>
                    )}

                    {report?.summary && (
                      <p className="mt-2 text-sm text-stone-600">{report.summary}</p>
                    )}

                    {report &&
                      ((report.strengths && report.strengths.length > 0) ||
                        (report.gaps && report.gaps.length > 0)) && (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {report.strengths && report.strengths.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                                Strengths
                              </p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                                {report.strengths.map((x, j) => (
                                  <li key={j}>{x}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {report.gaps && report.gaps.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                                To review
                              </p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                                {report.gaps.map((x, j) => (
                                  <li key={j}>{x}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                    <p className="mt-4 text-sm text-stone-600">
                      {failed
                        ? "Something went wrong partway, so we saved this as a partial attempt for your teacher. Please feel free to take the quiz again."
                        : "Saved for your teacher. If you’re not happy with your score, feel free to take the quiz again."}
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={close}
                  disabled={!finished}
                  className="mt-5 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Close
                </button>
              </div>
            )}

            {phase === "error" && (
              <div>
                <h2 className="font-serif text-xl font-bold text-stone-900">
                  Couldn’t start the quiz
                </h2>
                <p className="mt-2 text-sm text-red-600">{error}</p>
                <button
                  type="button"
                  onClick={close}
                  className="mt-5 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
