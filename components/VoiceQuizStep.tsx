"use client";

import type { Track } from "@/lib/content";
import VoiceQuiz from "./VoiceQuiz";

/**
 * The AI-voice-quiz action in a day's action bar on the home page — the last
 * of the row's boxed uppercase buttons ("ARTICLE · HANDOUT · AI QUIZ"). It's shown
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
  title,
  track = "senior",
  className,
}: {
  date: string;
  title: string;
  track?: Track;
  className?: string;
}) {
  return (
    <VoiceQuiz
      date={date}
      title={title}
      track={track}
      launcherClassName={className}
      launcherLabel="AI Quiz"
    />
  );
}
