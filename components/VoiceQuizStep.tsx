"use client";

import VoiceQuiz from "./VoiceQuiz";

/**
 * The AI-voice-quiz action in a day's compact action bar on the home page. It
 * renders as one more middot-separated item — " · Voice quiz" — appended after
 * the Handout link, bringing its OWN leading middot. It's shown to EVERYONE,
 * signed in or not: the launcher is always visible, and clicking it while
 * logged out pops a "You need to log in" message instead of starting a session
 * (that gate lives in VoiceQuiz's `launch()`). So the public can see the
 * feature but can't run up OpenAI charges without logging in.
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
  return (
    <>
      <span className="mx-2.5 text-stone-300" aria-hidden>
        ·
      </span>
      <span className="inline-block align-baseline">
        <VoiceQuiz date={date} title={title} />
      </span>
    </>
  );
}
