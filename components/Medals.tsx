"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { useAuth } from "./AuthProvider";
import type { Track } from "@/lib/content";
import {
  MEDAL_ICON,
  MEDAL_LABEL,
  localYMD,
  type MarkLevel,
  type Medal,
  type MedalMap,
  type Streak,
} from "@/lib/medals";

/**
 * The logged-in viewer's daily medals for one track — one fetch of
 * /api/medals on mount, shared by every leaf on the page that shows a medal
 * (the streak ribbon, the index rows' medal, the handout's finish box), the
 * AuthProvider lesson: never a fetch per row. Every login earns
 * medals (parents read too); a logged-out visitor gets an empty context (no
 * fetch — the API would 401).
 *
 * `mark(date, level)` records an attestation and swaps in the server's fresh
 * map + streak, so the ribbon ticks up the moment the student marks a day.
 * Gold arrives from the voice quiz, which is saved elsewhere: VoiceQuiz
 * dispatches MEDAL_EVENT on the window after a graded save and the provider
 * refetches, so the row and ribbon update without a reload.
 *
 * The last answer is cached in localStorage per (user, track), the
 * AuthProvider recipe: restored before the first paint, so the streak
 * ribbon (a tall bar above the readings) and the row medals paint in place
 * instead of pushing the page down when the fetch lands. The fetch then
 * corrects the copy.
 */

export const MEDAL_EVENT = "rc:medal";

export type MedalsState = { medals: MedalMap; streak: Streak };

type MedalsContext = {
  /** True once the auth state is known. */
  ready: boolean;
  /** The viewer is logged in (every login, parent or student, has medals). */
  loggedIn: boolean;
  /** null until loaded (or when the viewer has no medals to load). */
  state: MedalsState | null;
  /** The last fetch failed (with nothing cached, the medals stay off). */
  failed: boolean;
  mark: (date: string, level: MarkLevel) => Promise<MedalsState | null>;
};

const Ctx = createContext<MedalsContext>({
  ready: false,
  loggedIn: false,
  state: null,
  failed: false,
  mark: async () => null,
});

const CACHE_PREFIX = "rc-medals:";

function readCache(user: string, track: Track): MedalsState | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${user}:${track}`);
    return raw ? parseState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(user: string, track: Track, s: MedalsState) {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${user}:${track}`, JSON.stringify(s));
  } catch {
    // Storage unavailable — the medals just wait for the fetch.
  }
}

function parseState(d: unknown): MedalsState | null {
  if (!d || typeof d !== "object") return null;
  const o = d as { medals?: unknown; streak?: unknown };
  if (!o.medals || typeof o.medals !== "object" || !o.streak) return null;
  return { medals: o.medals as MedalMap, streak: o.streak as Streak };
}

export function MedalsProvider({
  track,
  children,
}: {
  track: Track;
  children: React.ReactNode;
}) {
  const { user, ready } = useAuth();
  const loggedIn = ready && Boolean(user);
  const [state, setState] = useState<MedalsState | null>(null);
  const [failed, setFailed] = useState(false);

  // Before the first paint (the auth cache restores `user` in a layout
  // effect too, so this runs in the same pre-paint pass).
  useLayoutEffect(() => {
    // Deliberate: localStorage can't be read during render without a
    // hydration mismatch, and a layout effect still lands before paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) setState(readCache(user, track));
  }, [user, track]);

  const load = useCallback(async (): Promise<MedalsState | null> => {
    try {
      const r = await fetch(`/api/medals?track=${track}&today=${localYMD()}`);
      if (!r.ok) return null;
      return parseState(await r.json());
    } catch {
      // Best-effort chrome — a failed fetch just leaves the medals off.
      return null;
    }
  }, [track]);

  useEffect(() => {
    if (!loggedIn || !user) return;
    let stale = false;
    const refresh = () => {
      void load().then((s) => {
        if (stale) return;
        if (s) {
          setState(s);
          writeCache(user, track, s);
        } else {
          setFailed(true);
        }
      });
    };
    refresh();
    window.addEventListener(MEDAL_EVENT, refresh);
    return () => {
      stale = true;
      window.removeEventListener(MEDAL_EVENT, refresh);
    };
  }, [loggedIn, user, track, load]);

  const mark = useCallback(
    async (date: string, level: MarkLevel) => {
      try {
        const r = await fetch("/api/medals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ track, date, level, today: localYMD() }),
        });
        if (!r.ok) return null;
        const s = parseState(await r.json());
        if (s) {
          setState(s);
          if (user) writeCache(user, track, s);
        }
        return s;
      } catch {
        return null;
      }
    },
    [track, user],
  );

  return (
    <Ctx.Provider value={{ ready, loggedIn, state, failed, mark }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMedals(): MedalsContext {
  return useContext(Ctx);
}

/** The medal emoji with an accessible label. */
export function MedalIcon({
  medal,
  className = "",
}: {
  medal: Medal;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={MEDAL_LABEL[medal]}
      title={MEDAL_LABEL[medal]}
      className={`inline-block leading-none ${className}`}
    >
      {MEDAL_ICON[medal]}
    </span>
  );
}

/**
 * The medal beside an index row's date — renders nothing until the
 * viewer's map is loaded, and nothing for a day with no medal.
 */
export function RowMedal({
  date,
  className = "",
}: {
  date: string;
  className?: string;
}) {
  const { state } = useMedals();
  const medal = state?.medals[date];
  if (!medal) return null;
  return <MedalIcon medal={medal} className={className} />;
}
