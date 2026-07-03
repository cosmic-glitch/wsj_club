"use client";

import { createContext, useContext, useEffect, useState } from "react";

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

type Role = "teacher" | "student" | null;

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<Auth>({
    user: null,
    isAdmin: false,
    isOwner: false,
    role: null,
    ready: false,
  });

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) =>
        setAuth({
          user: d.username ?? null,
          isAdmin: Boolean(d.isAdmin),
          isOwner: Boolean(d.isOwner),
          role: (d.role as Role) ?? null,
          ready: true,
        })
      )
      .catch(() =>
        setAuth({
          user: null,
          isAdmin: false,
          isOwner: false,
          role: null,
          ready: true,
        })
      );
  }, []);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

/** Read the shared login state. Login/logout reload the page, so it stays fresh. */
export function useAuth(): Auth {
  return useContext(AuthContext);
}
