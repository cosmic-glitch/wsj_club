"use client";

import { useEffect, useRef, useState } from "react";

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

  // "Copied!" feedback after copying the playback link to the clipboard.
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(src);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (e.g. permissions) — no-op; the open-link is still there.
    }
  }

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
        <a href={src}>Open recording</a>
      </audio>
      {/* A shareable playback link rather than a file download: the bare Blob URL
          plays the recording inline in any browser, so pasting it into iMessage
          shows a clickable link the recipient can play — instead of a raw
          .webm/.mp4 attachment that shares poorly. Open it in a new tab, or copy
          it to share. */}
      <div className="mt-2 flex items-center gap-4">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] font-bold uppercase tracking-[.06em] text-[#0a0a0a] underline decoration-2 underline-offset-2 hover:bg-[#ffe600]"
        >
          Open in new tab
        </a>
        <button
          type="button"
          onClick={copyLink}
          className="font-mono text-[11px] font-bold uppercase tracking-[.06em] text-[#0a0a0a] underline decoration-2 underline-offset-2 hover:bg-[#ffe600]"
        >
          {copied ? "Copied!" : "Copy playback link"}
        </button>
      </div>
    </>
  );
}
