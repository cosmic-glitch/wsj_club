"use client";

import { useState, type ReactNode } from "react";
import { TRACKS, TRACK_LABEL, trackBase, type Track } from "@/lib/track";

/**
 * The home page's "All readings" archive, one tab per level. Every panel is
 * server-rendered (the page stays static); this only toggles which one shows.
 * Switching a tab also swaps the URL to that level's own address
 * ("/", "/middle-school", "/elementary") without a navigation, so the address
 * bar, a shared link and the header's per-level Word Bank link all follow the
 * tab. Those three URLs render this same page opened on their level.
 */
export default function LevelTabs({
  initial,
  panels,
}: {
  initial: Track;
  panels: Record<Track, ReactNode>;
}) {
  const [active, setActive] = useState<Track>(initial);

  const select = (t: Track) => {
    setActive(t);
    try {
      window.history.replaceState(null, "", trackBase(t) || "/");
    } catch {
      // The tab still switches; only the address bar stays put.
    }
  };

  return (
    <div>
      <div role="tablist" aria-label="Level" className="flex flex-wrap">
        {TRACKS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`level-tab-${t}`}
            aria-selected={active === t}
            aria-controls={`level-panel-${t}`}
            onClick={() => select(t)}
            className={`-mr-[3px] cursor-pointer border-[3px] border-b-0 border-[#0a0a0a] px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[.1em] min-[681px]:px-4 min-[681px]:text-[12px] ${
              active === t
                ? "bg-[#0a0a0a] text-[#ffe600]"
                : "bg-white text-[#0a0a0a] hover:bg-[#ffe600]"
            }`}
          >
            {TRACK_LABEL[t]}
          </button>
        ))}
      </div>
      {TRACKS.map((t) => (
        <div
          key={t}
          role="tabpanel"
          id={`level-panel-${t}`}
          aria-labelledby={`level-tab-${t}`}
          hidden={active !== t}
        >
          {panels[t]}
        </div>
      ))}
    </div>
  );
}
