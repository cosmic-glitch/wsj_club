"use client";

import { useEffect, useState } from "react";
import VoiceQuiz from "./VoiceQuiz";

/**
 * The "Voice quiz" step inside a day's card on the home page. Shown only once
 * someone is logged in — signed-out visitors (kids just browsing) never see it
 * (the same gate the old table column used, just inline for the card layout).
 * Login and logout both reload the page, so the login check stays fresh.
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
    <li>
      Or take the AI{" "}
      <span className="inline-block align-middle">
        <VoiceQuiz date={date} title={title} />
      </span>
    </li>
  );
}
