"use client";

import { useEffect, useRef } from "react";

/**
 * Audio player for a saved quiz recording on /admin.
 *
 * The recordings are produced in the browser with MediaRecorder (webm/opus, or
 * mp4 on Safari). MediaRecorder writes the file as a live stream and never goes
 * back to stamp the total duration into the header, so the browser reports the
 * duration as `Infinity` until it has buffered all the way to the end. The
 * visible symptom is a seek bar that starts at 0 and only grows as the clip
 * plays, instead of showing the full length like a normal player.
 *
 * The fix is the well-known "seek to the end" trick: once metadata loads, if the
 * duration is non-finite we jump the playhead far past the end, which forces the
 * browser to read through the whole file and compute the real duration, then we
 * snap back to the start. After that `duration` is a finite number and the seek
 * bar shows the full length up front.
 */
export default function SessionAudio({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);

  // The recording lives on Vercel Blob, a different origin, so the HTML
  // `download` attribute is ignored (browsers refuse cross-origin downloads).
  // Blob honors a `?download=1` query param that responds with
  // `Content-Disposition: attachment`, which forces a save instead of in-tab
  // playback — the reliable way to give the teacher a "share this file" link.
  const downloadUrl = src.includes("?")
    ? `${src}&download=1`
    : `${src}?download=1`;

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;

    function fixDuration() {
      const el = ref.current;
      if (!el) return;
      // Finite, real duration already known — nothing to do.
      if (Number.isFinite(el.duration) && el.duration > 0) return;

      const onTimeUpdate = () => {
        el.removeEventListener("timeupdate", onTimeUpdate);
        // Duration is now known; rewind to the start without disturbing playback.
        el.currentTime = 0;
      };
      el.addEventListener("timeupdate", onTimeUpdate);
      // A huge value the browser clamps to the true end, forcing it to scan the
      // whole stream and learn the real duration.
      el.currentTime = 1e101;
    }

    audio.addEventListener("loadedmetadata", fixDuration);
    // If metadata is already loaded (e.g. on a fast refresh), run it now.
    if (audio.readyState >= 1) fixDuration();

    return () => audio.removeEventListener("loadedmetadata", fixDuration);
  }, [src]);

  return (
    <>
      {/* preload="metadata" so the duration-fix can run before the teacher hits play. */}
      <audio ref={ref} controls preload="metadata" src={src} className="mt-2 w-full">
        <a href={downloadUrl}>Download recording</a>
      </audio>
      {/* Save the file (e.g. to share a strong attempt with another student). */}
      <a
        href={downloadUrl}
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 hover:text-sky-800 hover:underline"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="h-4 w-4 fill-current"
        >
          <path d="M8 1a.75.75 0 0 1 .75.75v6.69l1.72-1.72a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 1.06-1.06l1.72 1.72V1.75A.75.75 0 0 1 8 1ZM2.75 11a.75.75 0 0 1 .75.75v1.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-1.5a.75.75 0 0 1 .75-.75Z" />
        </svg>
        Download recording
      </a>
    </>
  );
}
