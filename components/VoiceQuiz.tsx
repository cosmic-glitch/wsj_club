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
 * review on /admin. The student deliberately sees NEITHER the live transcript
 * NOR the report card — only a "saved for your teacher" confirmation.
 */
export default function VoiceQuiz({ date, title }: { date: string; title: string }) {
  // Login state is fetched on mount; login/logout both reload the page, so this
  // stays fresh. Checking it here (not on click) keeps the click a clean user
  // gesture for getUserMedia / audio autoplay.
  const [user, setUser] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<Turn[]>([]);

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

  function cleanupConnection() {
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
  }

  async function start() {
    setError("");
    transcriptRef.current = [];
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
        if (audioRef.current) audioRef.current.srcObject = e.streams[0];
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
    setPhase("ending");
    cleanupConnection();
    try {
      // Grade + save (transcript + report card) to Blob for the teacher. The
      // returned report is intentionally not shown to the student.
      await fetch("/api/quiz-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, studentName: user, transcript: transcriptRef.current }),
      });
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
    transcriptRef.current = [];
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
                <p className="mt-2 text-sm text-stone-600">
                  Your quiz has been saved for your teacher to review.
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
