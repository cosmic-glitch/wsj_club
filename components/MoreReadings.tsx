"use client";

import { useState, type ReactNode } from "react";

// Collapses the index's older rows (everything past the first ten) behind a
// full-width "show more" row at the bottom of the list. The hidden rows are
// server-rendered and passed in as children, so the page stays static — this
// component only toggles whether they're mounted. One click reveals them all
// and the button row goes away (the true last row then picks up the list's
// last:border-b-0 on its own).
export default function MoreReadings({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) return <>{children}</>;

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block w-full cursor-pointer px-3.5 py-3 text-center font-mono text-[11px] font-bold uppercase tracking-[.14em] hover:bg-[#0a0a0a] hover:text-[#ffe600]"
      >
        ↓ Show {count} older {count === 1 ? "reading" : "readings"}
      </button>
    </li>
  );
}
