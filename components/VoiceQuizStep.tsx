"use client";

import VoiceQuiz from "./VoiceQuiz";

/**
 * The AI-voice-quiz action in a day's action bar on the home page — the last
 * of the row's boxed uppercase buttons ("WEB · PDF · HANDOUT · AI QUIZ"). It's
 * shown
 * to EVERYONE, signed in or not: the launcher is always visible, and clicking
 * it while logged out pops a "You need to log in" message instead of starting
 * a session (that gate lives in VoiceQuiz's `launch()`). So the public can see
 * the feature but can't run up OpenAI charges without logging in.
 *
 * This wrapper is styling-only: the page passes the shared action-button
 * classes via `className`, forwarded to the launcher button inside VoiceQuiz.
 * Render this only for days with `voiceQuiz: true`; the parent decides that.
 */
export default function VoiceQuizStep({
  date,
  className,
}: {
  date: string;
  className?: string;
}) {
  return (
    <VoiceQuiz date={date} launcherClassName={className} launcherLabel="AI Quiz" />
  );
}
