"use client";

import { useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Teacher-only "Delete" button shown next to each session on /admin. Confirms,
 * then asks the server to delete the session JSON (and its audio recording) from
 * Blob, then refreshes the list.
 */
export default function DeleteSessionButton({
  url,
  audioUrl,
  label,
  onDeleted,
}: {
  url: string;
  audioUrl?: string;
  label: string;
  // Optional: called after a successful delete (e.g. to close the modal it sits
  // in). The list still refreshes via router.refresh() regardless.
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(e: MouseEvent) {
    // The button sits inside the <summary>; don't toggle the details open/closed.
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete this quiz session (${label})? This can't be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quiz-session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, audioUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed.");
      }
      router.refresh();
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
