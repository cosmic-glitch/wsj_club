"use client";

import { useRef, useState } from "react";

/**
 * A small "hear it" button next to a vocab word or concept name on the handout.
 * Plays that term's pre-generated OpenAI-TTS clip (a natural US-English voice).
 *
 * There is NO browser-speech fallback — the robotic Web Speech voice was
 * deliberately dropped. If there's no clip (`audioSrc` absent) the button
 * doesn't render at all (the page only passes a src when the mp3 exists), so
 * there's never a dead button; if the clip fails to load mid-play it just stops.
 */
export default function PronounceButton({
  text,
  label,
  audioSrc,
  className = "",
}: {
  text: string; // the term (used only for the aria-label)
  label?: string; // for the aria-label; defaults to `text`
  audioSrc?: string; // the pre-generated mp3 URL — no src, no button
  className?: string;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!audioSrc) return null;

  function play() {
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio(audioSrc);
      audio.onplaying = () => {
        setLoading(false);
        setSpeaking(true);
      };
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => {
        setLoading(false);
        setSpeaking(false);
      };
      audioRef.current = audio;
    }
    setLoading(true);
    audio.currentTime = 0;
    audio.play().catch(() => setLoading(false));
  }

  return (
    <button
      type="button"
      onClick={play}
      disabled={loading}
      aria-busy={loading}
      aria-label={`Hear "${label ?? text}" pronounced`}
      title="Hear it"
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center border-2 border-[#0a0a0a] transition active:translate-y-px disabled:cursor-wait ${
        speaking || loading ? "bg-[#ffe600]" : "bg-white hover:bg-[#ffe600]"
      } ${className}`}
    >
      {/* A small speaker glyph in ink; pulses while loading/speaking. */}
      <svg
        viewBox="0 0 24 24"
        className={`h-3.5 w-3.5 text-[#0a0a0a] ${loading ? "animate-pulse" : ""}`}
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M11 5 6 9H3v6h3l5 4V5z" />
        <path
          d="M15.5 8.5a4 4 0 0 1 0 7M18 6a7 7 0 0 1 0 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
