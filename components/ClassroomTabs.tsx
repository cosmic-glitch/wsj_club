"use client";

import { useState, type ReactNode } from "react";

export type ClassroomTab = { key: string; label: string; content: ReactNode };

/**
 * Owner-only tabbed switcher over multiple classrooms (the Scores + Manage
 * Students pages). Each tab's content is server-rendered and passed in as a
 * ReactNode; every panel stays mounted (inactive ones hidden with `hidden`) so
 * switching tabs preserves any in-panel state — an open attempt modal, a
 * half-typed rename — and never refetches. Collapses to just the content when
 * there's a single classroom, so a lone teacher sees no tab bar.
 */
export default function ClassroomTabs({ tabs }: { tabs: ClassroomTab[] }) {
  const [active, setActive] = useState(0);

  if (tabs.length <= 1) return <>{tabs[0]?.content ?? null}</>;

  return (
    <div>
      {/* Boxed uppercase toggle buttons — the selected classroom is the
          inverted (black/yellow) one, matching the site's button language. */}
      <div role="tablist" aria-label="Classrooms" className="flex flex-wrap gap-2">
        {tabs.map((t, i) => {
          const selected = i === active;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(i)}
              className={`border-2 border-[#0a0a0a] px-4 py-2 font-mono text-xs font-bold uppercase tracking-[.06em] transition ${
                selected
                  ? "bg-[#0a0a0a] text-[#ffe600]"
                  : "bg-white text-[#0a0a0a] hover:bg-[#ffe600]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tabs.map((t, i) => (
        <div key={t.key} role="tabpanel" hidden={i !== active}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
