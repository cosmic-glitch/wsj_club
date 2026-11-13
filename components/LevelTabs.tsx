"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { TRACKS, TRACK_LABEL, levelHash, type Track } from "@/lib/track";

const STORE = "rc-level-tab";

function levelOf(v: string | null | undefined): Track | null {
  return TRACKS.find((t) => levelHash(t) === v || t === v) ?? null;
}

/**
 * The home page's "Older readings" archive, one tab per level. Every panel is
 * server-rendered (the page stays static); this only toggles which one shows.
 * The site has ONE home URL ("/"): a link may name a tab by hash
 * ("/#middle-school" — the level strip on inner pages, the old per-level URLs'
 * redirects), otherwise the tab this browser last picked opens (a per-viewer
 * convenience in localStorage), else High School. Picked before the first
 * paint (layout effect), so the panel doesn't visibly swap.
 */
export default function LevelTabs({ panels }: { panels: Record<Track, ReactNode> }) {
  const [active, setActive] = useState<Track>("senior");

  useLayoutEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORE);
    } catch {
      // Storage unavailable — fall through to the default.
    }
    const pick = levelOf(window.location.hash) ?? levelOf(stored);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the hash/storage must wait for the client
    if (pick) setActive(pick);
  }, []);

  const select = (t: Track) => {
    setActive(t);
    try {
      localStorage.setItem(STORE, t);
      // Drop a stale tab hash so a reload doesn't override the pick.
      if (window.location.hash) window.history.replaceState(null, "", "/");
    } catch {
      // The tab still switches.
    }
  };

  return (
    <div>
      <div role="tablist" aria-label="Level" className="flex">
        {TRACKS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`level-tab-${t}`}
            aria-selected={active === t}
            aria-controls={`level-panel-${t}`}
            onClick={() => select(t)}
            // min-w-0 + the -mr overlap stay inside the column on a phone
            // (the three tabs used to run past the screen's right edge).
            className={`-mr-[3px] min-w-0 cursor-pointer border-[3px] border-b-0 border-[#0a0a0a] px-2.5 py-2 font-mono text-[10.5px] font-bold uppercase tracking-[.08em] last:mr-0 min-[681px]:px-4 min-[681px]:text-[12px] min-[681px]:tracking-[.1em] ${
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
