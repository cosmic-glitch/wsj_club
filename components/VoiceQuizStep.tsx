"use client";

import VoiceQuiz from "./VoiceQuiz";
import { useAuth } from "./AuthProvider";

/**
 * The AI-voice-quiz action in a day's compact action bar on the home page. It
 * renders as one more middot-separated item — " · Voice quiz" — appended after
 * the Handout link. Shown only once someone is logged in: signed-out visitors
 * (kids just browsing) never see it, and because it brings its OWN leading
 * middot, the bar has no dangling separator when it's hidden. Login and logout
 * both reload the page, so the check stays fresh.
 *
 * Login state comes from the shared AuthProvider (one /api/me fetch for the
 * whole page), so every day's link appears together rather than one-by-one.
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
  const { user } = useAuth();

  if (!user) return null;

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
