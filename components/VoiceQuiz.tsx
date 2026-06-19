"use client";

import { useEffect, useRef, useState } from "react";

type Turn = { role: "student" | "tutor"; text: string };

type Phase =
  | "idle" // modal closed
  | "needLogin" // clicked while logged out
  | "connecting"
  | "live"
  | "ending"
  | "done"
  | "error";

/**
 * The "Voice quiz" launcher in the home-page table. Clicking it:
 *   - logged out → a small "You need to log in" popup;
 *   - logged in  → opens a modal and immediately starts a WebRTC
 *     speech-to-speech session with the OpenAI Realtime API, so an AI tutor
 *     quizzes the student aloud about that day's article.
 *
 * The transcript is captured and, on "End quiz", POSTed to the server, which
 * grades it into a report card and saves both to Vercel Blob for the teacher to
 * review on /admin. The student does NOT see the live transcript or the full
 * report card — but at the end they ARE shown their overall score (just the
 * number) plus an invitation to retake the quiz if they're not happy with it.
 *
 * The whole conversation is ALSO recorded as audio: both the student's mic and
 * the tutor's voice are already live MediaStreams in the browser, so we mix them
 * with the Web Audio API and run a MediaRecorder over the result (no change to
 * the WebRTC/model path). On "End quiz" the recording is uploaded to Blob and
 * linked from the session for the teacher to play back. Recording is
 * best-effort: if it can't start or upload, the quiz proceeds normally.
 */
export default function VoiceQuiz({ date, title }: { date: string; title: string }) {
  // Login state is fetched on mount; login/logout both reload the page, so this
  // stays fresh. Checking it here (not on click) keeps the click a clean user
  // gesture for getUserMedia / audio autoplay.
  const [user, setUser] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  // The graded score (e.g. "8/10"), shown to the student on the done screen.
  // null until the report comes back; "—" means there was nothing to grade.
  const [score, setScore] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<Turn[]>([]);

  // Audio recording: a MediaRecorder over a Web Audio mix of the mic + the
  // tutor's remote track. All best-effort — a failure here never breaks the quiz.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Auto-end: the tutor calls the end_quiz tool when the conversation is
  // logically over. We don't tear down instantly (that would clip the spoken
  // goodbye) — we wait for the wrap-up audio to finish, with a timer as a
  // fallback. The manual "End quiz" button still works as an early-exit.
  const endStartedRef = useRef(false); // end() has begun (manual OR auto) — runs once
  const endRequestedRef = useRef(false); // tutor asked to end; waiting on its audio
  const endFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioPlayingRef = useRef(false); // tutor audio currently playing

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setUser(d.username ?? null))
      .catch(() => setUser(null));
  }, []);

  function pushTurn(turn: Turn) {
    transcriptRef.current = [...transcriptRef.current, turn];
  }

  // The transcript is captured for the teacher's record, not shown to the
  // student.
  function handleEvent(raw: string) {
    let evt: {
      type?: string;
      transcript?: string;
      name?: string;
      item?: { type?: string; name?: string };
    };
    try {
      evt = JSON.parse(raw);
    } catch {
      return;
    }
    const type = evt.type ?? "";
    if (type === "conversation.item.input_audio_transcription.completed") {
      if (evt.transcript?.trim()) pushTurn({ role: "student", text: evt.transcript.trim() });
    } else if (
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      if (evt.transcript?.trim()) pushTurn({ role: "tutor", text: evt.transcript.trim() });
    } else if (
      // The tutor signals the quiz is logically over by calling the end_quiz
      // tool. (Both event shapes carry the name; either one is enough.)
      (type === "response.function_call_arguments.done" && evt.name === "end_quiz") ||
      (type === "response.output_item.done" &&
        evt.item?.type === "function_call" &&
        evt.item?.name === "end_quiz")
    ) {
      requestAutoEnd();
    } else if (type === "output_audio_buffer.started") {
      audioPlayingRef.current = true;
    } else if (type === "output_audio_buffer.stopped") {
      audioPlayingRef.current = false;
      // If the tutor asked to end, its goodbye has now finished playing — so this
      // is the moment to tear down without clipping it.
      if (endRequestedRef.current) void end();
    }
  }

  // Pick a container the browser can actually record (Chrome/Firefox: webm/opus;
  // Safari: mp4). Undefined → let MediaRecorder choose its default.
  function pickRecorderMime(): { mimeType: string } | undefined {
    if (typeof MediaRecorder === "undefined") return undefined;
    for (const mimeType of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
      if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType };
    }
    return undefined;
  }

  // Mix the student's mic and the tutor's remote track into one stream and record
  // it. The remote track is still played to the student through the <audio>
  // element (keeping it "live" so Web Audio actually receives samples) — this
  // graph only feeds the recorder, not the speakers.
  function startRecording(remote: MediaStream) {
    const mic = micRef.current;
    if (!mic || recorderRef.current) return; // ontrack can fire more than once
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(mic).connect(dest);
      ctx.createMediaStreamSource(remote).connect(dest);

      const rec = new MediaRecorder(dest.stream, pickRecorderMime());
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.start();
      recorderRef.current = rec;
    } catch (err) {
      // Recording is a bonus, never a blocker — the quiz goes on without it.
      console.error("Could not start recording:", err);
    }
  }

  // Stop the recorder and resolve with the finished audio Blob (null if there's
  // nothing recorded). Awaits the recorder's final "stop" so all chunks land.
  function stopRecording(): Promise<Blob | null> {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const chunks = chunksRef.current;
        chunksRef.current = [];
        resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || "audio/webm" }) : null);
      };
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }

  function cleanupConnection() {
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    // Defensive teardown for the error/unmount paths; end() stops the recorder
    // first to capture the Blob, so by then this is a no-op.
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        // already stopped
      }
    }
    recorderRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    // Drop any pending auto-end timer so it can't fire after teardown/unmount.
    if (endFallbackRef.current) {
      clearTimeout(endFallbackRef.current);
      endFallbackRef.current = null;
    }
    endRequestedRef.current = false;
  }

  async function start() {
    setError("");
    setScore(null);
    transcriptRef.current = [];
    endStartedRef.current = false;
    endRequestedRef.current = false;
    audioPlayingRef.current = false;
    setPhase("connecting");

    try {
      // 1. Mic permission (this click is the user gesture that lets audio play).
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;

      // 2. Mint an ephemeral key from our server (login-gated).
      const tokenRes = await fetch("/api/realtime-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, studentName: user }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        throw new Error(tokenData.error ?? "Could not start the session.");
      }
      const { value: ephemeralKey, model } = tokenData;

      // 3. WebRTC peer connection.
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        const remote = e.streams[0];
        if (audioRef.current) audioRef.current.srcObject = remote;
        startRecording(remote);
      };
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));

      const dc = pc.createDataChannel("oai-events");
      dc.onmessage = (e) => handleEvent(e.data);
      dc.onopen = () => {
        // Nudge the tutor to speak first (the greeting).
        dc.send(JSON.stringify({ type: "response.create" }));
      };

      // 4. Offer / answer SDP exchange with OpenAI.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
        }
      );
      if (!sdpRes.ok) {
        throw new Error("Voice connection was refused.");
      }
      const answer = { type: "answer" as const, sdp: await sdpRes.text() };
      await pc.setRemoteDescription(answer);

      setPhase("live");
    } catch (err) {
      cleanupConnection();
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  // The button click — preserves the user gesture (no awaits before start()).
  function launch() {
    if (!user) {
      setPhase("needLogin");
      return;
    }
    start();
  }

  // The tutor's end_quiz tool fired. Don't tear down immediately — that would
  // clip the spoken goodbye — wait for the wrap-up audio to finish
  // (output_audio_buffer.stopped), with a timer fallback in case it never comes.
  function requestAutoEnd() {
    if (endRequestedRef.current || endStartedRef.current) return;
    endRequestedRef.current = true;
    // Audio still playing → wait for it to stop (long safety fallback). Nothing
    // playing → the goodbye likely already finished, so end after a short grace.
    const fallbackMs = audioPlayingRef.current ? 12000 : 1500;
    endFallbackRef.current = setTimeout(() => void end(), fallbackMs);
  }

  async function end() {
    if (endStartedRef.current) return; // manual button + auto-end: only run once
    endStartedRef.current = true;
    endRequestedRef.current = false;
    if (endFallbackRef.current) {
      clearTimeout(endFallbackRef.current);
      endFallbackRef.current = null;
    }
    setPhase("ending");
    // Stop the recorder first so we capture the full Blob, then tear down.
    const audioBlob = await stopRecording();
    cleanupConnection();

    // Upload the recording (best-effort) and link it from the saved session.
    let audioUrl: string | undefined;
    if (audioBlob && audioBlob.size > 0) {
      try {
        const fd = new FormData();
        fd.append("audio", audioBlob, "quiz");
        fd.append("date", date);
        fd.append("studentName", user ?? "");
        const r = await fetch("/api/quiz-audio", { method: "POST", body: fd });
        if (r.ok) audioUrl = (await r.json()).url;
      } catch {
        // No recording link — the transcript + report still save below.
      }
    }

    try {
      // Grade + save (transcript + report card + audio link) to Blob for the
      // teacher. We keep the full report card private, but DO surface the
      // overall score to the student on the done screen.
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
      const s = data?.report?.score;
      if (typeof s === "string" && s.trim()) setScore(s.trim());
    } catch {
      // The session still happened; saving is best-effort.
    } finally {
      setPhase("done");
    }
  }

  function close() {
    cleanupConnection();
    setPhase("idle");
    setError("");
    setScore(null);
    transcriptRef.current = [];
    endStartedRef.current = false;
    endRequestedRef.current = false;
    audioPlayingRef.current = false;
  }

  // Stop the mic/connection if the component unmounts mid-session.
  useEffect(() => () => cleanupConnection(), []);

  const modalOpen = phase !== "idle";
  // While the session is live we don't let a stray backdrop click drop the call.
  const dismissable = phase === "needLogin" || phase === "done" || phase === "error";

  return (
    <>
      <button
        type="button"
        onClick={launch}
        className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-800"
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
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <audio ref={audioRef} autoPlay className="hidden" />

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

            {phase === "connecting" && (
              <div>
                <h2 className="font-serif text-xl font-bold text-stone-900">
                  Starting your voice quiz…
                </h2>
                <p className="mt-2 text-sm text-stone-500">
                  Connecting — please allow microphone access when your browser asks.
                </p>
              </div>
            )}

            {phase === "live" && (
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-3 w-3 animate-pulse rounded-full bg-red-500" />
                  <h2 className="font-serif text-xl font-bold text-stone-900">
                    Live — just talk
                  </h2>
                </div>
                <p className="mt-2 text-sm text-stone-600">
                  Your tutor is quizzing you about “{title}.” Speak naturally and
                  take your time — there’s no rush, and pauses are fine.
                </p>
                <p className="mt-2 text-xs text-stone-400">
                  This quiz is recorded and saved for your teacher.
                </p>
                <button
                  type="button"
                  onClick={end}
                  className="mt-5 rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700"
                >
                  End quiz
                </button>
              </div>
            )}

            {phase === "ending" && (
              <div>
                <h2 className="font-serif text-xl font-bold text-stone-900">
                  Wrapping up…
                </h2>
                <p className="mt-2 text-sm text-stone-500">
                  Saving your quiz for your teacher.
                </p>
              </div>
            )}

            {phase === "done" && (
              <div>
                <h2 className="font-serif text-xl font-bold text-stone-900">
                  All done — nice work!
                </h2>
                {score && score !== "—" ? (
                  <>
                    <p className="mt-3 text-sm text-stone-600">
                      Your score:{" "}
                      <span className="text-lg font-bold text-sky-700">
                        {score}
                      </span>
                    </p>
                    <p className="mt-2 text-sm text-stone-600">
                      Your quiz has been saved for your teacher. If you’re not
                      happy with your score, you can always take the quiz again.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-stone-600">
                    Your quiz has been saved for your teacher. You can take the
                    quiz again any time if you’d like.
                  </p>
                )}
                <button
                  type="button"
                  onClick={close}
                  className="mt-5 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
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
