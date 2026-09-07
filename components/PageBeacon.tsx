"use client";

import { useEffect, useRef } from "react";
import type { Track } from "@/lib/content";
import type { EventKind } from "@/lib/events";

/**
 * Fire-and-forget activity beacon for the STATIC pages (handout, self-quiz,
 * word bank) — the TodayTag recipe: the page stays statically generated and
 * this leaf hydrates in, sends ONE POST /api/events on mount, renders nothing.
 * Identity is the login cookie, resolved server-side; a logged-out view lands
 * in the anonymous bucket. The served article pages don't use this (they're
 * plain HTML) — their beacon lives in public/glossary.js, same endpoint.
 *
 * The body goes as plain text carrying JSON (what sendBeacon sends for a
 * string, and what the route parses) with `keepalive`, so a tab closing
 * right after the load still delivers. `fired` guards React strict mode's
 * double effect in dev; a real re-mount (back to the page) is a new view and
 * counts again, which is what we want.
 */
export function sendEvent(e: {
  kind: EventKind;
  track: Track;
  date: string | null;
  meta?: Record<string, unknown>;
}): void {
  try {
    const body = JSON.stringify(e);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", body);
      return;
    }
    fetch("/api/events", {
      method: "POST",
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    // Best-effort chrome — a lost event changes nothing for the reader.
  }
}

export default function PageBeacon({
  kind,
  track,
  date = null,
}: {
  kind: EventKind;
  track: Track;
  date?: string | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    sendEvent({ kind, track, date });
  }, [kind, track, date]);
  return null;
}
