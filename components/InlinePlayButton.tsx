"use client";

import { useRef, useState } from "react";

/**
 * A compact play/pause control for a saved recording, shown right in the Scores
 * table so a teacher (or student) can listen without opening the detail modal.
 * The <audio> uses preload="none" so the recording is only fetched on first
 * play — a page with many attempts doesn't pull down every clip up front.
 *
 * Only one inline player runs at a time: before starting, we pause any other
 * inline player on the page (matched by the data-inline-play marker). Playing
 * state is driven off the element's own play/pause/ended events, so it stays
 * correct even when another player pauses this one.
 */
export default function InlinePlayButton({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  function toggle() {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      document
        .querySelectorAll<HTMLAudioElement>("audio[data-inline-play]")
        .forEach((a) => {
          if (a !== el) a.pause();
        });
      el.play().catch(() => {
        // Playback blocked or the clip failed to load — leave the button idle.
      });
    } else {
      el.pause();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause recording" : "Play recording"}
        title={playing ? "Pause recording" : "Play recording"}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <audio
        ref={ref}
        src={src}
        preload="none"
        data-inline-play
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </>
  );
}
