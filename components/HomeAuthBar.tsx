"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";

// The site's login/scores controls: small uppercase mono TEXT links —
// deliberately not boxed, so the boxed buttons stay exclusively "content
// actions" in the index rows. Hovering inverts (black bg, yellow text). Used
// in the landing page's thin topline ABOVE the masthead AND in the site-wide
// header on every inner page (SiteHeader): inline login form when logged out,
// word-bank/scores/students links + log out when logged in. The links render as ONE
// unbreakable unit (so a wrap can never strand a "/" separator); only the
// greeting — shown on the landing topline, suppressed in the header
// (showGreeting={false}) to keep it uncluttered on phones — may wrap away
// onto its own line.
const bar =
  "inline-block cursor-pointer px-1.5 py-1 font-mono text-[11px] font-bold uppercase leading-normal tracking-[.12em] text-[#0a0a0a] no-underline hover:bg-[#0a0a0a] hover:text-[#ffe600]";

// The "/" between items.
function Slash() {
  return (
    <span aria-hidden className="font-mono text-[11px] font-bold text-[#0a0a0a]">
      /
    </span>
  );
}

export default function HomeAuthBar({
  showGreeting = true,
}: {
  showGreeting?: boolean;
}) {
  const { user, isAdmin, ready } = useAuth();
  // The Word Bank is per-track (the SiteHeader monogram recipe): from a junior
  // page it links to the junior bank, everywhere else the senior one.
  const pathname = usePathname();
  const wordBankHref = pathname?.startsWith("/junior") ? "/junior/words" : "/words";
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

  // Reserve the bar's height before /api/me answers so the page doesn't jump.
  if (!ready) return <span className="py-1 font-mono text-[11px]">&nbsp;</span>;

  if (user) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5">
        {showGreeting && (
          <span className="mr-1.5 px-1.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[.12em] text-stone-400">
            Hi {user}
          </span>
        )}
        {/* One unbreakable unit: on a narrow screen the whole link group wraps
            together (below the greeting / the header wordmark), so a line can
            never end or start with a stray "/". */}
        <span className="flex items-center gap-1 whitespace-nowrap">
          {/* Personal, so every logged-in user gets it — sits with My Scores. */}
          <Link href={wordBankHref} className={bar}>
            My Word Bank
          </Link>
          <Slash />
          {isAdmin ? (
            <>
              <Link href="/admin" className={bar}>
                All Scores
              </Link>
              <Slash />
              <Link href="/admin/students" className={bar}>
                Students
              </Link>
              <Slash />
            </>
          ) : (
            <>
              <Link href="/admin" className={bar}>
                My Scores
              </Link>
              <Slash />
            </>
          )}
          <button type="button" onClick={logout} className={bar}>
            Log out
          </button>
        </span>
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
          className="absolute right-0 top-full z-20 mt-2 w-64 space-y-2 border-[3px] border-[#0a0a0a] bg-white p-4 font-mono shadow-[6px_6px_0_#ffe600,6px_6px_0_3px_#0a0a0a]"
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
