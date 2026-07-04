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
      <div
        role="tablist"
        aria-label="Classrooms"
        className="flex flex-wrap gap-1 border-b border-stone-200"
      >
        {tabs.map((t, i) => {
          const selected = i === active;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(i)}
              className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition ${
                selected
                  ? "border-stone-900 text-stone-900"
                  : "border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800"
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
