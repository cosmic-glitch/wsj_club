"use client";

import { useEffect, useRef, useState } from "react";

type Turn = { role: "student" | "tutor"; text: string };

type Report = {
  score?: string;
  summary?: string;
  strengths?: string[];
  gaps?: string[];
  keyIdeas?: string;
  vocab?: string;
  concepts?: string;
};

type Phase = "idle" | "connecting" | "live" | "ending" | "done";

/**
 * The "Quiz me" voice feature: opens a WebRTC speech-to-speech session with the
 * OpenAI Realtime API so an AI tutor quizzes the student aloud about the day's
 * article. Login-gated (the token endpoint checks the session cookie). On hang-up
 * the transcript is sent to the server, graded into a report card, and saved.
 *
 * During the testing phase this lives quietly at the bottom of the handout page.
 */
export default function VoiceQuiz({ date, title }: { date: string; title: string }) {
  const [user, setUser] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [studentName, setStudentName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef<Turn[]>([]);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        setUser(d.username ?? null);
        if (d.username) setStudentName(d.username);
      })
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  function pushTurn(turn: Turn) {
    transcriptRef.current = [...transcriptRef.current, turn];
    setTranscript(transcriptRef.current);
  }

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
    setReport(null);
    setTranscript([]);
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
        body: JSON.stringify({ date, studentName }),
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
      setPhase("idle");
    }
  }

  async function end() {
    setPhase("ending");
    cleanupConnection();
    try {
      const res = await fetch("/api/quiz-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, studentName, transcript: transcriptRef.current }),
      });
      const data = await res.json();
      setReport(data.report ?? null);
    } catch {
      // The session still happened; just no report.
      setReport(null);
    } finally {
      setPhase("done");
    }
  }

  // Stop the mic/connection if the component unmounts mid-session.
  useEffect(() => () => cleanupConnection(), []);

  // The whole feature is hidden until login (login lives only in the top bar).
  if (!ready || !user) return null;

  return (
    <section className="mt-16 border-t border-dashed border-stone-300 pt-8">
      <audio ref={audioRef} autoPlay className="hidden" />

      <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
        Beta · voice quiz
      </p>
      <h2 className="mt-1 font-serif text-2xl font-bold text-stone-900">Quiz me out loud</h2>
      <p className="mt-1 text-sm text-stone-500">
        An AI tutor will quiz you by voice about “{title}.” It’ll start by asking
        you to explain the article in your own words — take your time, and don’t
        worry about pauses. Then it’ll ask about the words and ideas.
      </p>

      {phase === "idle" && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-stone-500">Your name</span>
            <input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={start}
            className="rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-800"
          >
            Start voice quiz
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {phase === "connecting" && (
        <p className="mt-4 text-sm text-stone-500">Connecting… allow microphone access.</p>
      )}

      {phase === "live" && (
        <div className="mt-4">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 animate-pulse rounded-full bg-red-500" />
            <span className="text-sm font-medium text-stone-700">
              Live — just talk. The tutor is listening.
            </span>
            <button
              type="button"
              onClick={end}
              className="ml-auto rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
            >
              End quiz
            </button>
          </div>
        </div>
      )}

      {phase === "ending" && (
        <p className="mt-4 text-sm text-stone-500">Wrapping up and grading…</p>
      )}

      {/* Live / final transcript */}
      {transcript.length > 0 && (
        <div className="mt-5 space-y-2">
          {transcript.map((t, i) => (
            <p key={i} className="text-sm">
              <span
                className={
                  t.role === "tutor"
                    ? "font-semibold text-sky-700"
                    : "font-semibold text-stone-700"
                }
              >
                {t.role === "tutor" ? "Tutor" : studentName || "You"}:{" "}
              </span>
              <span className="text-stone-600">{t.text}</span>
            </p>
          ))}
        </div>
      )}

      {phase === "done" && (
        <div className="mt-6">
          {report ? <ReportCard report={report} /> : (
            <p className="text-sm text-stone-500">Quiz finished. (No report was generated.)</p>
          )}
          <button
            type="button"
            onClick={() => {
              setPhase("idle");
              setReport(null);
              setTranscript([]);
              transcriptRef.current = [];
            }}
            className="mt-4 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            Quiz again
          </button>
        </div>
      )}
    </section>
  );
}

function ReportCard({ report }: { report: Report }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-xl font-bold text-stone-900">Report card</h3>
        {report.score && (
          <span className="text-lg font-bold text-sky-700">{report.score}</span>
        )}
      </div>
      {report.summary && <p className="mt-2 text-stone-700">{report.summary}</p>}

      {report.strengths && report.strengths.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
            Strengths
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
            {report.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {report.gaps && report.gaps.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
            To review
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
            {report.gaps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 space-y-1 text-sm text-stone-600">
        {report.keyIdeas && (
          <p>
            <span className="font-semibold text-stone-500">Key ideas: </span>
            {report.keyIdeas}
          </p>
        )}
        {report.vocab && (
          <p>
            <span className="font-semibold text-stone-500">Vocabulary: </span>
            {report.vocab}
          </p>
        )}
        {report.concepts && (
          <p>
            <span className="font-semibold text-stone-500">Concepts: </span>
            {report.concepts}
          </p>
        )}
      </div>
    </div>
  );
}
