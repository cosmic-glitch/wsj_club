"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";

// The home page's login/scores controls, restyled for the brutalist landing:
// boxed uppercase mono buttons in the same black-on-white style as the row
// buttons, sitting quietly right-aligned under the masthead. Same behavior as
// the site-wide AuthControl (which the home page no longer shows — see
// SiteHeader): inline login form when logged out, scores/students links +
// log out when logged in.
const bar =
  "inline-block cursor-pointer border-2 border-[#0a0a0a] px-[10px] py-[5px] text-[10.5px] font-bold uppercase leading-normal tracking-[.08em] text-[#0a0a0a] no-underline transition-colors hover:bg-[#0a0a0a] hover:text-[#ffe600]";

export default function HomeAuthBar() {
  const { user, isAdmin, ready } = useAuth();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close the login popover when clicking outside it.
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
      // Reload so the voice-quiz launchers etc. pick up the new session.
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

  // Reserve the strip's height before /api/me answers so the page doesn't jump.
  if (!ready) return <span className="py-[5px] text-[10.5px]">&nbsp;</span>;

  if (user) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-1 text-[10.5px] font-bold uppercase tracking-[.14em]">
          Hi {user}
        </span>
        {isAdmin ? (
          <>
            <Link href="/admin" className={bar}>
              All Scores
            </Link>
            <Link href="/admin/students" className={bar}>
              Students
            </Link>
          </>
        ) : (
          <Link href="/admin" className={bar}>
            My Scores
          </Link>
        )}
        <button type="button" onClick={logout} className={bar}>
          Log out
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={bar}>
        Log in
      </button>
      {open && (
        <form
          onSubmit={login}
          className="absolute right-0 top-full z-20 mt-2 w-64 space-y-2 border-[3px] border-[#0a0a0a] bg-white p-4 shadow-[6px_6px_0_#ffe600,6px_6px_0_3px_#0a0a0a]"
        >
          <input
            type="text"
            placeholder="USERNAME"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="w-full border-2 border-[#0a0a0a] px-3 py-2 text-sm text-[#0a0a0a] placeholder:text-stone-400 focus:bg-[#fffbd6] focus:outline-none"
          />
          <input
            type="password"
            placeholder="PASSWORD"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full border-2 border-[#0a0a0a] px-3 py-2 text-sm text-[#0a0a0a] placeholder:text-stone-400 focus:bg-[#fffbd6] focus:outline-none"
          />
          {error && (
            <p className="text-xs font-bold uppercase tracking-[.06em] text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full cursor-pointer border-2 border-[#0a0a0a] bg-[#0a0a0a] px-3 py-2 text-sm font-bold uppercase tracking-[.1em] text-[#ffe600] transition enabled:hover:bg-[#ffe600] enabled:hover:text-[#0a0a0a] disabled:opacity-50"
          >
            {busy ? "…" : "Log in"}
          </button>
        </form>
      )}
    </div>
  );
}
