"use client";

import { useEffect, useState } from "react";
import VoiceQuiz from "./VoiceQuiz";

/**
 * The AI-voice-quiz half of the card's last step. The 1-1 quiz and the voice
 * quiz are alternatives (you do one or the other), so they share one bullet:
 * the parent renders "Schedule your 1-1 quiz" and this appends ", or take the
 * AI [Voice quiz]" inline. Shown only once someone is logged in — signed-out
 * visitors (kids just browsing) never see it (so the bullet is just the 1-1
 * quiz for them). Login and logout both reload the page, so the check stays
 * fresh.
 *
 * Render this only for days with `voiceQuiz: true`; the parent decides that.
 */
export default function VoiceQuizStep({
  date,
  title,
}: {
  date: string;
  title: string;
}) {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setAuthed(Boolean(d.username)))
      .catch(() => setAuthed(false));
  }, []);

  if (!authed) return null;

  return (
    <>
      , or take the AI{" "}
      <span className="inline-block align-middle">
        <VoiceQuiz date={date} title={title} />
      </span>
    </>
  );
}
