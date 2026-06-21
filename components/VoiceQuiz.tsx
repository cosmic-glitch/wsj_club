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
  // we send to transcription. Each turn's clip is also kept in answerBlobsRef so
  // we can stitch them into one file for the teacher at the end.
  const turnRecRef = useRef<MediaRecorder | null>(null);
  const turnChunksRef = useRef<Blob[]>([]);
  const answerBlobsRef = useRef<Blob[]>([]);

  // iOS-only PCM capture (no MediaRecorder): a ScriptProcessor pulls raw samples
  // off a fresh mic each turn. iosSamplesRef accumulates the current turn; the
  // 16 kHz result is kept per turn in iosTurnPcmRef for the teacher's WAV.
  const iosCtxRef = useRef<AudioContext | null>(null);
  const iosMicRef = useRef<MediaStream | null>(null);
  const iosSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const iosProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const iosSamplesRef = useRef<Float32Array[]>([]);
  const iosRecordingRef = useRef(false);
  const iosTurnPcmRef = useRef<Float32Array[]>([]);

  // Level meter animation + the elapsed-time timer.
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelsRef = useRef<number[]>(new Array(METER_BARS).fill(0));

  // The quiz ends only when the student clicks "End quiz". This once-guard keeps
  // end() idempotent and lets cancel() block a racing end().
  const endStartedRef = useRef(false);

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

  // "Start speaking" — a state toggle (no press-and-hold). Begins recording the
  // student's answer off the Web Audio graph; the live meter + timer make it
  // obvious the mic is hot.
  async function startSpeaking() {
    if (phase !== "tutorTurn") return;
    setNotice("");
    stopTts(); // if the tutor is still talking, the student is taking over
    // iOS records via raw-PCM capture (MediaRecorder is unreliable there);
    // desktop records the Web Audio graph's output with MediaRecorder.
    if (isIOS) {
      try {
        await iosStartCapture();
      } catch (err) {
        console.warn("[voicequiz] iOS capture failed", err);
        setNotice("Couldn't start the microphone. Please allow mic access and try again.");
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
  // then ask for the tutor's next line.
  async function stopSpeaking() {
    if (phase !== "recording") return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopMeterLoop();

    // Collect this answer's clip (iOS: a WAV from PCM capture; desktop: the
    // recorder's webm/mp4), and keep it for the teacher's stitched recording.
    let turn: { blob: Blob; filename: string } | null;
    if (isIOS) {
      const cap = iosStopCapture();
      if (cap) {
        iosTurnPcmRef.current = [...iosTurnPcmRef.current, cap.pcm];
        turn = { blob: cap.blob, filename: cap.filename };
      } else {
        turn = null;
      }
    } else {
      turn = await stopTurnRecorder();
      if (turn) answerBlobsRef.current = [...answerBlobsRef.current, turn.blob];
    }
    if (!turn) {
      setNotice("I didn't catch any audio. Tap Start speaking to try again.");
      setPhase("tutorTurn");
      return;
    }

    setPhase("transcribing");
    try {
      const form = new FormData();
      form.append("file", turn.blob, turn.filename);
      const res = await fetch("/api/quiz-transcribe", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice("Sorry, I couldn't transcribe that. Tap Start speaking to try again.");
        setPhase("tutorTurn");
        return;
      }
      const text = (data?.text ?? "").trim();
      if (!text) {
        setNotice("I didn't catch any words — speak a bit louder/closer and tap Start speaking to try again.");
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

  // The teacher's recording: every answer stitched into one file. On iOS we
  // concat the per-turn PCM and encode one clean WAV (seekable, plays in order);
  // on desktop we concat the recorder clips (same config → plays in order).
  function buildTeacherFile(): { blob: Blob; ext: string } | null {
    if (isIOS) {
      const pcms = iosTurnPcmRef.current.filter((p) => p.length);
      if (!pcms.length) return null;
      return { blob: encodeWav(mergeFloat32(pcms), WAV_RATE), ext: "wav" };
    }
    const blobs = answerBlobsRef.current.filter((b) => b.size > 0);
    if (!blobs.length) return null;
    const type = blobs[0].type || "audio/webm";
    const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
    return { blob: new Blob(blobs, { type }), ext };
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
    setCanRetry(false);
    setReport(null);
    setUploadStep("pending");
    setGradeStep("pending");
    setFinished(false);
    setTurns([]);
    transcriptRef.current = [];
    answerBlobsRef.current = [];
    iosTurnPcmRef.current = [];
    endStartedRef.current = false;
    setPhase("starting");

    try {
      // Mic permission — this click is the user gesture that also lets audio play.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
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

    // If they hit End quiz mid-answer, close out that clip and keep it.
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopMeterLoop();
    // Close out an in-progress answer (if they pressed End mid-recording) so it's
    // included in the teacher's stitched file.
    if (phase === "recording") {
      if (isIOS) {
        const cap = iosStopCapture();
        if (cap) iosTurnPcmRef.current = [...iosTurnPcmRef.current, cap.pcm];
      } else {
        const lastTurn = await stopTurnRecorder();
        if (lastTurn && lastTurn.blob.size > 0) {
          answerBlobsRef.current = [...answerBlobsRef.current, lastTurn.blob];
        }
      }
    }
    const session = buildTeacherFile();
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
