"use client";

import { useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Owner-only "Delete" action — a SINGLE delete for a whole quiz attempt, shown
 * once per row on /admin (in the Details action bar, not inside the per-section
 * modal). It confirms, then asks the server to delete the whole session — the
 * DB row *and* its Blob record + audio recording — then refreshes the list.
 * `id` is the DB row id (Phase 3 read flip): a uuid for a terminal session, or
 * the serialized `slot:…` id for an in-progress slot.
 *
 * Styled as an inline red text link so it sits alongside the row's other
 * action-bar links.
 */
export default function DeleteSessionButton({
  id,
  label,
}: {
  id: string;
  // A human label for the confirm prompt, e.g. "Arjun · The Last Question".
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete(e: MouseEvent) {
    // It's a sibling of the modal-opening links; don't let the click bubble.
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete this quiz attempt (${label})? This can't be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/quiz-session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed.");
      }
      router.refresh();
    } catch (err) {
      setBusy(false);
      // A bordered inline error would break the tight row layout; a native
      // alert keeps the table stable and failures are rare.
      alert(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={busy}
      className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-[.06em] text-red-600 underline decoration-2 underline-offset-2 hover:bg-red-600 hover:text-white disabled:opacity-50"
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
