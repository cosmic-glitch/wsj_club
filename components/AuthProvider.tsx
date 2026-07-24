"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

/**
 * Shared login state for the whole app, fetched from /api/me ONCE.
 *
 * Before this, every component that cared about login (the header control plus
 * one VoiceQuizStep + VoiceQuiz per day) fetched /api/me on its own mount — so a
 * logged-in home page fired ~2 requests per row (a dozen-plus identical calls),
 * and each row's "Voice quiz" link only appeared after its own fetch resolved,
 * making them pop in one-by-one. A single shared fetch fixes both: one request,
 * and every consumer renders together the moment it returns.
 *
 * It's still a client-side fetch (so the pages it wraps stay statically
 * generated) — just hoisted to one place instead of repeated per component.
 */

type Role = "parent" | "student" | null;

type Auth = {
  user: string | null;
  isAdmin: boolean;
  isOwner: boolean;
  role: Role;
  ready: boolean; // false until the first /api/me has resolved
};

const AuthContext = createContext<Auth>({
  user: null,
  isAdmin: false,
  isOwner: false,
  role: null,
  ready: false,
});

/**
 * Last-known login snapshot, cached in localStorage so a full page load can
 * paint the auth bar in its final state immediately — without it, every hard
 * navigation (login/logout reload, refresh, direct URL) flashed a blank bar
 * until /api/me answered, making the top bar jitter instead of reading as
 * static chrome. The cache is display-only (the httpOnly cookie is still the
 * real session): the background /api/me corrects a stale copy within a moment.
 */
const CACHE_KEY = "rc-auth";

type AuthSnapshot = Omit<Auth, "ready">;

function readAuthCache(): AuthSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (typeof d.user !== "string" || !d.user) return null;
    return {
      user: d.user,
      isAdmin: Boolean(d.isAdmin),
      isOwner: Boolean(d.isOwner),
      role: d.role === "parent" || d.role === "student" ? d.role : null,
    };
  } catch {
    return null;
  }
}

export function writeAuthCache(snap: AuthSnapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snap));
  } catch {
    // Storage unavailable (private mode etc.) — the bar just keeps the
    // pre-cache behavior of waiting for /api/me.
  }
}

export function clearAuthCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<Auth>({
    user: null,
    isAdmin: false,
    isOwner: false,
    role: null,
    ready: false,
  });

  // Before the first paint, restore the last-known login state so the bar
  // renders fully formed on a hard load (no blank → links pop-in jitter).
  // useLayoutEffect runs after hydration (so the server-rendered placeholder
  // matches) but before the browser paints.
  useLayoutEffect(() => {
    const cached = readAuthCache();
    if (cached) setAuth({ ...cached, ready: true });
  }, []);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        const snap: AuthSnapshot = {
          user: d.username ?? null,
          isAdmin: Boolean(d.isAdmin),
          isOwner: Boolean(d.isOwner),
          role: (d.role as Role) ?? null,
        };
        if (snap.user) writeAuthCache(snap);
        else clearAuthCache();
        setAuth({ ...snap, ready: true });
      })
      .catch(() =>
        // Network hiccup: keep whatever we're showing (cached or blank)
        // rather than flashing a logged-in user to logged-out.
        setAuth((a) => ({ ...a, ready: true }))
      );
  }, []);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

/** Read the shared login state. Login/logout reload the page, so it stays fresh. */
export function useAuth(): Auth {
  return useContext(AuthContext);
}
