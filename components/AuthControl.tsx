"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The login/logout control in the header. Fetches the current login state from
 * /api/me on mount (so the static pages it lives on stay static), and shows a
 * small inline login form when logged out.
 */
export default function AuthControl() {
  const [user, setUser] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setUser(d.username ?? null))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  // Close the popover when clicking outside it.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      // Reload so other components (e.g. the handout's voice quiz, which only
      // appears once logged in) pick up the new session.
      window.location.reload();
    } catch {
      setError("Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.reload();
  }

  if (!ready) return <span className="text-sm text-stone-300">·</span>;

  if (user) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-stone-500">
          Hi, <span className="font-medium text-stone-800">{user}</span>
        </span>
        <button
          type="button"
          onClick={logout}
          className="text-stone-500 transition hover:text-stone-900"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm text-stone-500 transition hover:text-stone-900"
      >
        Log in
      </button>
      {open && (
        <form
          onSubmit={login}
          className="absolute right-0 top-8 z-10 w-60 space-y-2 rounded-xl border border-stone-200 bg-white p-4 shadow-lg"
        >
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white transition enabled:hover:bg-stone-700 disabled:opacity-50"
          >
            {busy ? "…" : "Log in"}
          </button>
        </form>
      )}
    </div>
  );
}
