"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { useAuth } from "./AuthProvider";

type Turn = { role: "student" | "tutor"; text: string };

// The graded report card the student sees at the end — the same shape the
// teacher reviews on /admin (minus the private transcript + recording).
type Report = {
  score?: string;
  summary?: string;
  strengths?: string[];
  gaps?: string[];
};

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
 * shown their full report card. A single continuous recorder captures only the
 * student's spoken answers (pause/resume between turns) into ONE playable file,
 * uploaded straight to Blob (via /api/quiz-audio's token) and linked from the
 * session for the teacher to play back. Recording is best-effort — a failure
 * never breaks the quiz.
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
  // When a mid-quiz tutor-turn request fails, we keep the session alive and show
  // a Retry instead of dropping to the fatal error screen.
  const [canRetry, setCanRetry] = useState(false);

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

  // Two recorders over the same mic stream:
  //  - sessionRec: ONE recorder for the whole quiz, paused between turns, so the
  //    saved teacher file is just the student's answers stitched into one clip.
  //  - turnRec: a fresh recorder per turn, whose clip we send to transcription.
  const sessionRecRef = useRef<MediaRecorder | null>(null);
  const sessionChunksRef = useRef<Blob[]>([]);
  const turnRecRef = useRef<MediaRecorder | null>(null);
  const turnChunksRef = useRef<Blob[]>([]);

  // Mic-level metering during recording (analyser + animation loop + timer).
  // The analyser taps a CLONE of the mic (meterStreamRef), never the recorder's
  // own track, so the Web Audio graph can't starve the MediaRecorder.
  const meterCtxRef = useRef<AudioContext | null>(null);
  const meterStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelsRef = useRef<number[]>(new Array(METER_BARS).fill(0));

  // The quiz ends only when the student clicks "End quiz". This once-guard keeps
  // end() idempotent and lets cancel() block a racing end().
  const endStartedRef = useRef(false);

  function appendTurn(turn: Turn) {
    transcriptRef.current = [...transcriptRef.current, turn];
    setTurns(transcriptRef.current);
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
  // screen, so the quiz simply continues silently for that turn.
  async function speak(text: string) {
    stopTts();
    setTtsPlaying(true);
    try {
      const res = await fetch("/api/quiz-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("tts");
      const blob = await res.blob();
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
  // show + speak it. `first` is the opening greeting/question.
  async function nextTutorTurn(first: boolean) {
    setNotice("");
    setCanRetry(false);
    setPhase(first ? "starting" : "thinking");
    try {
      const res = await fetch("/api/quiz-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, studentName: user, transcript: transcriptRef.current }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.text) {
        throw new Error(data?.error ?? "Could not get the next question.");
      }
      appendTurn({ role: "tutor", text: data.text });
      setPhase("tutorTurn");
      void speak(data.text);
    } catch (err) {
      if (first) {
        // Nothing has happened yet — a clean fatal error is fine.
        teardown();
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setPhase("error");
      } else {
        // Keep the session alive; let the student retry the next question.
        setNotice("Trouble reaching the tutor. Tap Retry to continue.");
        setCanRetry(true);
        setPhase("tutorTurn");
      }
    }
  }

  // ---- Recording one answer ----------------------------------------------

  async function startMeter() {
    const mic = micRef.current;
    if (!mic) return;
    try {
      const ctx = new AudioContext();
      meterCtxRef.current = ctx;
      // A fresh AudioContext is often "suspended" until resumed — in that state
      // the analyser reads pure silence and, worse, tapping the mic track from a
      // suspended graph can starve the MediaRecorder of audio. Resume first.
      if (ctx.state === "suspended") await ctx.resume();

      // Tap a CLONE of the mic so this graph is fully isolated from the
      // recorder's own track (the recorder keeps the original).
      const meterStream = new MediaStream(mic.getAudioTracks().map((t) => t.clone()));
      meterStreamRef.current = meterStream;
      const source = ctx.createMediaStreamSource(meterStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      // Route source → analyser → muted gain → destination. The muted sink keeps
      // the graph "pulled" (some browsers won't run an analyser that dead-ends);
      // gain 0 means nothing is actually played, and it's the mic — no echo.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(analyser);
      analyser.connect(sink);
      sink.connect(ctx.destination);

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
    } catch (err) {
      // The meter is decorative — recording still works without it.
      console.warn("[voicequiz] meter failed", err);
    }
  }

  function stopMeter() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    meterCtxRef.current?.close().catch(() => {});
    meterCtxRef.current = null;
    meterStreamRef.current?.getTracks().forEach((t) => t.stop());
    meterStreamRef.current = null;
    levelsRef.current = new Array(METER_BARS).fill(0);
    setLevels(levelsRef.current);
  }

  // "Start speaking" — a state toggle (no press-and-hold). Begins recording the
  // student's mic; the live meter + timer make it obvious the mic is hot.
  function startSpeaking() {
    if (phase !== "tutorTurn") return;
    setNotice("");
    stopTts(); // if the tutor is still talking, the student is taking over

    const mic = micRef.current;
    if (!mic) return;

    // The continuous teacher recorder: create-and-start on the first answer,
    // resume on later ones (it was paused after the previous answer).
    try {
      if (!sessionRecRef.current) {
        const rec = new MediaRecorder(mic, pickRecorderMime());
        sessionChunksRef.current = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) sessionChunksRef.current.push(e.data);
        };
        rec.start();
        sessionRecRef.current = rec;
      } else if (sessionRecRef.current.state === "paused") {
        sessionRecRef.current.resume();
      }
    } catch {
      // Teacher recording is best-effort — keep going.
    }

    // Surface the mic track's state — a `muted`/`ended` track here explains a
    // silent recording even with the mic LED on.
    const track = mic.getAudioTracks()[0];
    if (track) {
      console.log("[voicequiz] mic track", {
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        label: track.label,
      });
    }

    // The per-turn recorder, whose clip we transcribe. A timeslice makes data
    // flush as it's captured (and confirms audio is actually flowing).
    try {
      const rec = new MediaRecorder(mic, pickRecorderMime());
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

    setRecSeconds(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    void startMeter();
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

  // "Stop" — finish the answer: pause the teacher recorder, transcribe the clip,
  // show it, then ask for the tutor's next line.
  async function stopSpeaking() {
    if (phase !== "recording") return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopMeter();

    const turn = await stopTurnRecorder();
    // Pause (don't stop) the teacher recorder so the next answer appends to the
    // same file.
    try {
      if (sessionRecRef.current?.state === "recording") sessionRecRef.current.pause();
    } catch {
      // ignore
    }

    if (!turn) {
      setNotice("I didn't catch any audio. Tap Start speaking to try again.");
      setPhase("tutorTurn");
      return;
    }

    setPhase("transcribing");
    try {
      console.log("[voicequiz] answer blob", turn.blob.size, turn.blob.type);
      const form = new FormData();
      form.append("file", turn.blob, turn.filename);
      const res = await fetch("/api/quiz-transcribe", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      console.log("[voicequiz] transcribe", res.status, data);
      if (!res.ok) {
        // Beta diagnostic: show the upstream detail + the recorded clip's size so
        // we can tell an empty/garbled recording from a real server problem.
        const m = data?.meta ? `[${(data.meta.size / 1024).toFixed(0)}KB ${data.meta.type || "?"}] ` : "";
        setNotice(`Transcribe failed ${res.status}: ${m}${data?.detail ?? ""}`.trim());
        setPhase("tutorTurn");
        return;
      }
      const text = (data?.text ?? "").trim();
      if (!text) {
        // The clip recorded but held no recognizable speech — usually too quiet
        // or the mic captured silence.
        setNotice(
          `I didn't catch any words (recorded ${(turn.blob.size / 1024).toFixed(0)} KB). ` +
            "Speak a bit louder/closer and tap Start speaking to try again."
        );
        setPhase("tutorTurn");
        return;
      }
      appendTurn({ role: "student", text });
      await nextTutorTurn(false);
    } catch (err) {
      console.warn("[voicequiz] transcribe failed", err);
      setNotice("Network problem reaching the transcriber. Tap Start speaking to try again.");
      setPhase("tutorTurn");
    }
  }

  // ---- Teardown ------------------------------------------------------------

  // Stop the teacher recorder and resolve the single stitched recording.
  function stopSessionRecorder(): Promise<{ blob: Blob; ext: string } | null> {
    const rec = sessionRecRef.current;
    sessionRecRef.current = null;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const chunks = sessionChunksRef.current;
        sessionChunksRef.current = [];
        if (!chunks.length) return resolve(null);
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "mp4" : "webm";
        resolve({ blob: new Blob(chunks, { type }), ext });
      };
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }

  function teardown() {
    stopTts();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopMeter();
    for (const rec of [turnRecRef.current, sessionRecRef.current]) {
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          // ignore
        }
      }
    }
    turnRecRef.current = null;
    sessionRecRef.current = null;
    turnChunksRef.current = [];
    sessionChunksRef.current = [];
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
  }

  // ---- Start / end / cancel / close --------------------------------------

  async function start() {
    setError("");
    setNotice("");
    setCanRetry(false);
    setReport(null);
    setUploadStep("pending");
    setGradeStep("pending");
    setFinished(false);
    setTurns([]);
    transcriptRef.current = [];
    endStartedRef.current = false;
    setPhase("starting");

    try {
      // Mic permission — this click is the user gesture that also lets audio play.
      micRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access is needed for the voice quiz. Please allow it and try again.");
      setPhase("error");
      return;
    }
    await nextTutorTurn(true);
  }

  // The button click — preserves the user gesture (no awaits before start()).
  function launch() {
    if (!user) {
      setPhase("needLogin");
      return;
    }
    start();
  }

  async function end() {
    if (endStartedRef.current) return; // ignore a double-click — run once
    endStartedRef.current = true;
    setNotice("");
    setReport(null);
    setUploadStep("pending");
    setGradeStep("pending");
    setFinished(false);
    setPhase("wrapup");

    // If they hit End quiz mid-answer, close out that recording first.
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopMeter();
    await stopTurnRecorder();
    const session = await stopSessionRecorder();
    teardown();

    // 1. Upload the stitched recording (best-effort) — straight from the browser
    // to Blob via the client upload() flow, so the bytes skip our function and
    // its ~4.5MB request-body limit.
    let audioUrl: string | undefined;
    setUploadStep("active");
    if (session && session.blob.size > 0) {
      try {
        const safeName = (user ?? "student").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
        const blob = await upload(
          `quiz-sessions/${date}/${safeName}.${session.ext}`,
          session.blob,
          {
            access: "public",
            handleUploadUrl: "/api/quiz-audio",
            contentType: session.ext === "mp4" ? "audio/mp4" : "audio/webm",
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
    // and show the student their full report card.
    setGradeStep("active");
    try {
      const res = await fetch("/api/quiz-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          studentName: user,
          transcript: transcriptRef.current,
          audioUrl,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.report) setReport(data.report as Report);
    } catch {
      // The session still happened; saving is best-effort.
    } finally {
      setGradeStep("done");
      setFinished(true);
    }
  }

  // "Cancel quiz" — bail out with nothing saved: no recording uploaded, no
  // transcript graded, no session written. Setting the once-guard also blocks a
  // late end() from a double-click race.
  function cancel() {
    endStartedRef.current = true;
    close();
  }

  function close() {
    teardown();
    setPhase("idle");
    setError("");
    setNotice("");
    setCanRetry(false);
    setReport(null);
    setUploadStep("pending");
    setGradeStep("pending");
    setFinished(false);
    setTurns([]);
    transcriptRef.current = [];
    endStartedRef.current = false;
  }

  // Stop the mic/recorders if the component unmounts mid-session.
  useEffect(() => () => teardown(), []);

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
                      <div className="flex flex-wrap items-center gap-3">
                        {canRetry ? (
                          <button
                            type="button"
                            onClick={() => nextTutorTurn(false)}
                            className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-700"
                          >
                            Retry
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={startSpeaking}
                            className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
                          >
                            🎙 Start speaking
                          </button>
                        )}
                      </div>
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
                          recorded right now" cue. */}
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

                {/* End / Cancel are always available during a live quiz. */}
                <div className="mt-5 flex items-center gap-3 border-t border-stone-100 pt-4">
                  <button
                    type="button"
                    onClick={end}
                    className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
                  >
                    End quiz
                  </button>
                  <button
                    type="button"
                    onClick={cancel}
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
                  {finished ? "All done — nice work!" : "Wrapping up…"}
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
                      Saved for your teacher. If you’re not happy with your score, feel free to
                      take the quiz again.
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
