"use client";

import { useEffect, useState } from "react";
import VoiceQuiz from "./VoiceQuiz";

/**
 * The AI-voice-quiz action in a day's compact action bar on the home page. It
 * renders as one more middot-separated item — " · Voice quiz" — appended after
 * the Handout link. Shown only once someone is logged in: signed-out visitors
 * (kids just browsing) never see it, and because it brings its OWN leading
 * middot, the bar has no dangling separator when it's hidden. Login and logout
 * both reload the page, so the check stays fresh.
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
      <span className="mx-1.5 text-stone-300" aria-hidden>
        ·
      </span>
      <span className="inline-block align-baseline">
        <VoiceQuiz date={date} title={title} />
      </span>
    </>
  );
}
