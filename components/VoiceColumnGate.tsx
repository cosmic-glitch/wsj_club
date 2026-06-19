"use client";

import { useEffect, useState } from "react";

/**
 * Wraps the readings table and reveals the "Voice quiz" column only once
 * someone is logged in — so signed-out visitors (kids just browsing) never see
 * it and aren't surprised by it. Login state comes from /api/me; the column's
 * header + cells are `hidden` by default and switch to `table-cell` via
 * `group-data-[authed]` when a session exists. (Login and logout both reload the
 * page, so this stays in sync.)
 */
export default function VoiceColumnGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setAuthed(Boolean(d.username)))
      .catch(() => setAuthed(false));
  }, []);

  return (
    <div
      data-authed={authed ? "" : undefined}
      className="group overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm"
    >
      {children}
    </div>
  );
}
