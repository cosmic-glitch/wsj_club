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
  | "connecting"
  | "live"
  | "wrapup" // after "End quiz": one screen that fills in (upload → grade → score)
  | "error";

// The state of one step in the post-quiz wrap-up checklist.
type StepState = "pending" | "active" | "done";

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

/**
 * The "Voice quiz" launcher in the home-page action bar. It's shown to everyone
 * (logged in or not); the login check happens on click. Clicking it:
 *   - logged out → a small "You need to log in" popup;
 *   - logged in  → opens a modal and immediately starts a WebRTC
 *     speech-to-speech session with the OpenAI Realtime API, so an AI tutor
 *     quizzes the student aloud about that day's article.
 *
 * The transcript is captured and, on "End quiz", POSTed to the server, which
 * grades it into a report card and saves both to Vercel Blob for the teacher to
 * review on /admin. At the end the student is shown their full report card —
 * the same score + summary + strengths/gaps the teacher sees on /admin — plus
 * an invitation to retake the quiz if they're not happy with it. The live
 * transcript and the audio recording stay private (teacher-only).
 *
 * The whole conversation is ALSO recorded as audio: both the student's mic and
 * the tutor's voice are already live MediaStreams in the browser, so we mix them
 * with the Web Audio API and run a MediaRecorder over the result (no change to
 * the WebRTC/model path). On "End quiz" the recording is uploaded to Blob and
 * linked from the session for the teacher to play back. Recording is
 * best-effort: if it can't start or upload, the quiz proceeds normally.
 */
export default function VoiceQuiz({ date, title }: { date: string; title: string }) {
  // Login state comes from the shared AuthProvider (one /api/me fetch for the
  // whole page); login/logout both reload the page, so it stays fresh. Reading
  // it from context (not on click) keeps the click a clean user gesture for
  // getUserMedia / audio autoplay.
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  // The graded report card (score + summary + strengths/gaps), shown to the
  // student on the wrap-up screen — the same card the teacher sees on /admin.
  // null until the report comes back; score "—" means there was nothing to grade.
  const [report, setReport] = useState<Report | null>(null);
  // Post-quiz wrap-up: a persistent checklist on one screen (no screen-swap, so
  // it can't flash by). Each step fills in as it completes; `finished` reveals
  // the score line and enables Close.
  const [uploadStep, setUploadStep] = useState<StepState>("pending");
  const [gradeStep, setGradeStep] = useState<StepState>("pending");
  const [finished, setFinished] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<Turn[]>([]);

  // Audio recording: a MediaRecorder over a Web Audio mix of the mic + the
  // tutor's remote track. All best-effort — a failure here never breaks the quiz.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // The quiz ends only when the student clicks "End quiz" (the tutor tells them
  // to, once it has wrapped up). This once-guard keeps end() idempotent against
  // a double-click.
  const endStartedRef = useRef(false);

  function pushTurn(turn: Turn) {
    transcriptRef.current = [...transcriptRef.current, turn];
  }

  // The transcript is captured for the teacher's record, not shown to the
  // student.
  function handleEvent(raw: string) {
    let evt: { type?: string; transcript?: string };
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
  }

  async function start() {
    setError("");
    setReport(null);
    setUploadStep("pending");
    setGradeStep("pending");
    setFinished(false);
    transcriptRef.current = [];
    endStartedRef.current = false;
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

  async function end() {
    if (endStartedRef.current) return; // ignore a double-click — run once
    endStartedRef.current = true;
    setReport(null);
    setUploadStep("pending");
    setGradeStep("pending");
    setFinished(false);
    setPhase("wrapup");
    // Stop the recorder first so we capture the full Blob, then tear down.
    const audioBlob = await stopRecording();
    cleanupConnection();

    // 1. Upload the recording (best-effort) and link it from the saved session.
    // We upload straight from the browser to Blob via the client `upload()` flow
    // (/api/quiz-audio just mints an auth-gated token) so the bytes don't pass
    // through our serverless function — a full-length recording would otherwise
    // exceed the ~4.5MB request-body limit and 413.
    let audioUrl: string | undefined;
    setUploadStep("active");
    if (audioBlob && audioBlob.size > 0) {
      try {
        const ext = audioBlob.type.includes("mp4") ? "mp4" : "webm";
        const safeName = (user ?? "student")
          .replace(/[^a-zA-Z0-9_-]+/g, "-")
          .toLowerCase();
        const blob = await upload(
          `quiz-sessions/${date}/${safeName}.${ext}`,
          audioBlob,
          {
            access: "public",
            handleUploadUrl: "/api/quiz-audio",
            contentType: ext === "mp4" ? "audio/mp4" : "audio/webm",
            clientPayload: JSON.stringify({ date }),
          }
        );
        audioUrl = blob.url;
      } catch {
        // No recording link — the transcript + report still save below.
      }
    }
    setUploadStep("done");

    // 2. Grade + save (transcript + report card + audio link) to Blob for the
    // teacher, and show the student their full report card (score + summary +
    // strengths/gaps) on the wrap-up screen. The transcript + recording stay
    // teacher-only.
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

  // "Cancel quiz" — bail out of a live session with nothing saved: no recording
  // uploaded, no transcript graded, no session written. We just stop the
  // recorder (discarding its chunks), tear down the connection, and close.
  // Setting the once-guard also blocks a late end() from a double-click race.
  function cancel() {
    endStartedRef.current = true;
    close();
  }

  function close() {
    cleanupConnection();
    setPhase("idle");
    setError("");
    setReport(null);
    setUploadStep("pending");
    setGradeStep("pending");
    setFinished(false);
    transcriptRef.current = [];
    endStartedRef.current = false;
  }

  // Stop the mic/connection if the component unmounts mid-session.
  useEffect(() => () => cleanupConnection(), []);

  const modalOpen = phase !== "idle";
  // A stray backdrop click shouldn't drop a live call or interrupt the wrap-up
  // while it's still saving — only let it close once there's nothing in flight.
  const dismissable =
    phase === "needLogin" ||
    phase === "error" ||
    (phase === "wrapup" && finished);

  return (
    <>
      {/* Styled as a text link so it sits inline in the home-page action bar
          alongside the Article / Handout links (it's still a button — it opens
          the quiz modal). */}
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
                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={end}
                    className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700"
                  >
                    End quiz
                  </button>
                  {/* Cancel always sits beside End: it abandons the session with
                      nothing saved (no recording, no report) — for when the
                      student wants to bail out rather than be graded. */}
                  <button
                    type="button"
                    onClick={cancel}
                    className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
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
              <div>
                <h2 className="font-serif text-xl font-bold text-stone-900">
                  {finished ? "All done — nice work!" : "Wrapping up…"}
                </h2>
                <ul className="mt-4 space-y-2.5 text-sm">
                  <li className="flex items-center gap-2.5">
                    <StepIcon state={uploadStep} />
                    <span
                      className={
                        uploadStep === "pending"
                          ? "text-stone-400"
                          : "text-stone-700"
                      }
                    >
                      Uploading your recording
                    </span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <StepIcon state={gradeStep} />
                    <span
                      className={
                        gradeStep === "pending"
                          ? "text-stone-400"
                          : "text-stone-700"
                      }
                    >
                      Grading your quiz
                    </span>
                  </li>
                </ul>

                {/* The full report card — the same score + summary +
                    strengths/gaps the teacher sees on /admin (the transcript
                    and recording stay teacher-only). Scrolls if it runs long so
                    the Close button below stays reachable. */}
                {finished && (
                  <div className="mt-4 max-h-[55vh] overflow-y-auto border-t border-stone-100 pt-4">
                    {report?.score && report.score !== "—" && (
                      <p className="text-sm text-stone-600">
                        You scored{" "}
                        <span className="text-lg font-bold text-sky-700">
                          {report.score}
                        </span>
                        .
                      </p>
                    )}

                    {report?.summary && (
                      <p className="mt-2 text-sm text-stone-600">
                        {report.summary}
                      </p>
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
                      Saved for your teacher. If you’re not happy with your
                      score, feel free to take the quiz again.
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
