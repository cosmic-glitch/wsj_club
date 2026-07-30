"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { writeAuthCache } from "./AuthProvider";

/**
 * "Join" — the topline button that lets a visitor create their own login
 * (previously accounts existed only by asking the owner). Logged-out only: it
 * sits beside "Log in" in HomeAuthBar and disappears once signed in.
 *
 * Step 1 asks WHO is joining:
 *   - a student → one login; the server files them into the owner's classroom
 *     (a self-joining student has no parent on the site).
 *   - a parent → their own login PLUS a login per child, all in one form —
 *     one submit creates the whole family (/api/join).
 *
 * No display name is collected (display name = username) and email is
 * optional, kept only for future password recovery. Success logs the new
 * account in (the parent, in the family shape) — the done panel confirms the
 * created logins, and "Start reading" reloads so the whole page picks up the
 * session. The modal is portaled to document.body and top-anchored on phones
 * for the same iOS reasons as SuggestArticle's.
 */

const BTN_PRIMARY =
  "border-2 border-[#0a0a0a] bg-[#0a0a0a] px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-[.08em] text-[#ffe600] transition hover:bg-[#ffe600] hover:text-[#0a0a0a] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#ffe600]";
const BTN_SECONDARY =
  "border-2 border-[#0a0a0a] bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-[.06em] text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-[#ffe600]";
const MODAL_H2 = "font-display text-xl font-normal uppercase text-[#0a0a0a]";
const LABEL =
  "font-mono text-[10px] font-bold uppercase tracking-[.2em] text-stone-500";
const INPUT =
  "w-full border-2 border-[#0a0a0a] px-3 py-2 font-mono text-sm normal-case tracking-normal text-[#0a0a0a] placeholder:text-stone-400 focus:bg-[#fffbd6] focus:outline-none";

const MIN_PASSWORD = 6;

type Step = "choose" | "student" | "parent" | "done";
type Kid = { username: string; password: string };

export default function JoinClub({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [kids, setKids] = useState<Kid[]>([{ username: "", password: "" }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ username: string; kids: string[] } | null>(null);

  // Esc closes; body scroll locks while open (the SuggestArticle recipe).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  function openModal() {
    setStep("choose");
    setUsername("");
    setPassword("");
    setEmail("");
    setKids([{ username: "", password: "" }]);
    setError(null);
    setDone(null);
    setOpen(true);
  }

  function pickStep(s: Step) {
    setError(null);
    setStep(s);
  }

  const credsOk = (u: string, p: string) =>
    u.trim().length >= 3 && p.length >= MIN_PASSWORD;
  const canSubmit =
    credsOk(username, password) &&
    (step !== "parent" || kids.every((k) => credsOk(k.username, k.password)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !canSubmit) return;
    setPending(true);
    setError(null);
    const role = step === "parent" ? "parent" : "student";
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          username: username.trim(),
          password,
          email: email.trim() || undefined,
          ...(role === "parent"
            ? { children: kids.map((k) => ({ username: k.username.trim(), password: k.password })) }
            : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not create your account. Please try again.");
        return;
      }
      // Prime the auth cache so the post-join reload paints the logged-in bar
      // immediately (the login flow's recipe).
      try {
        const me = await fetch("/api/me").then((r) => r.json());
        if (me.username) {
          writeAuthCache({
            user: me.username,
            isAdmin: Boolean(me.isAdmin),
            isOwner: Boolean(me.isOwner),
            role: me.role ?? null,
          });
        }
      } catch {
        // Best-effort — worst case the reload shows a one-time flash.
      }
      setDone({ username: d.username, kids: d.children ?? [] });
      setStep("done");
    } catch {
      setError("Could not create your account. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const modal = !open
    ? null
    : createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-[#0a0a0a]/60 p-4 pt-14 sm:items-center sm:pt-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto border-[3px] border-[#0a0a0a] bg-white shadow-[8px_8px_0_#ffe600,8px_8px_0_3px_#0a0a0a]"
            onClick={(e) => e.stopPropagation()}
          >
            {step === "choose" && (
              <div className="p-6">
                <h2 className={MODAL_H2}>Join the club</h2>
                <p className="mt-2 font-sans text-[13px] leading-snug text-stone-600">
                  A login lets you take the daily voice quiz — an AI tutor asks
                  you about the article and grades your answers. Who&rsquo;s
                  joining?
                </p>
                <div className="mt-5 space-y-2">
                  <button
                    type="button"
                    onClick={() => pickStep("student")}
                    className="w-full cursor-pointer border-2 border-[#0a0a0a] bg-white px-4 py-3 text-left transition hover:bg-[#ffe600] hover:shadow-[4px_4px_0_#0a0a0a]"
                  >
                    <span className="block font-mono text-xs font-bold uppercase tracking-[.08em]">
                      I&rsquo;m a student
                    </span>
                    <span className="block font-sans text-[12px] text-stone-600">
                      Get your own login and start quizzing today.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => pickStep("parent")}
                    className="w-full cursor-pointer border-2 border-[#0a0a0a] bg-white px-4 py-3 text-left transition hover:bg-[#ffe600] hover:shadow-[4px_4px_0_#0a0a0a]"
                  >
                    <span className="block font-mono text-xs font-bold uppercase tracking-[.08em]">
                      I&rsquo;m a parent
                    </span>
                    <span className="block font-sans text-[12px] text-stone-600">
                      Sign up yourself and your kids in one go — you&rsquo;ll
                      see their quiz reports.
                    </span>
                  </button>
                </div>
              </div>
            )}

            {(step === "student" || step === "parent") && (
              <form onSubmit={submit} className="p-6">
                <h2 className={MODAL_H2}>
                  {step === "student" ? "Join as a student" : "Join as a parent"}
                </h2>
                <p className="mt-2 font-sans text-[13px] leading-snug text-stone-600">
                  {step === "student"
                    ? "Pick a username and a password (you'll use these to log in every day)."
                    : "Your login first, then a login for each of your kids — all created in one go."}
                </p>

                <div className="mt-5 space-y-4">
                  <label className={`block ${LABEL}`}>
                    {step === "parent" ? "Your username" : "Username"}
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase())}
                      placeholder="3–32 chars: a–z, 0–9, - or _"
                      autoComplete="username"
                      className={`mt-2 ${INPUT}`}
                    />
                  </label>
                  <label className={`block ${LABEL}`}>
                    {step === "parent" ? "Your password" : "Password"}
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={`At least ${MIN_PASSWORD} characters`}
                      autoComplete="new-password"
                      className={`mt-2 ${INPUT}`}
                    />
                  </label>
                  <label className={`block ${LABEL}`}>
                    Email — optional, for password resets
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      className={`mt-2 ${INPUT}`}
                    />
                  </label>

                  {step === "parent" && (
                    <fieldset>
                      <legend className={LABEL}>Your kids&rsquo; logins</legend>
                      <div className="mt-2 space-y-2">
                        {kids.map((k, i) => (
                          <div key={i} className="flex gap-2">
                            <input
                              value={k.username}
                              onChange={(e) =>
                                setKids((ks) =>
                                  ks.map((x, j) =>
                                    j === i
                                      ? { ...x, username: e.target.value.toLowerCase() }
                                      : x
                                  )
                                )
                              }
                              placeholder="username"
                              autoComplete="off"
                              className={INPUT}
                            />
                            <input
                              value={k.password}
                              onChange={(e) =>
                                setKids((ks) =>
                                  ks.map((x, j) =>
                                    j === i ? { ...x, password: e.target.value } : x
                                  )
                                )
                              }
                              placeholder="password"
                              autoComplete="off"
                              className={INPUT}
                            />
                            {kids.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setKids((ks) => ks.filter((_, j) => j !== i))}
                                aria-label={`Remove child ${i + 1}`}
                                className="shrink-0 px-1 text-stone-400 transition hover:bg-[#0a0a0a] hover:text-[#ffe600]"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {kids.length < 8 && (
                        <button
                          type="button"
                          onClick={() =>
                            setKids((ks) => [...ks, { username: "", password: "" }])
                          }
                          className="mt-2 font-mono text-[11px] font-bold uppercase tracking-[.06em] text-[#0a0a0a] hover:bg-[#ffe600]"
                        >
                          + Add another child
                        </button>
                      )}
                    </fieldset>
                  )}
                </div>

                {error && (
                  <p className="mt-3 font-sans text-[13px] font-bold text-red-700">{error}</p>
                )}

                <div className="mt-5 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={!canSubmit || pending}
                    className={`flex-1 ${BTN_PRIMARY}`}
                  >
                    {pending ? "Creating…" : "Join"}
                  </button>
                  <button
                    type="button"
                    onClick={() => pickStep("choose")}
                    className={BTN_SECONDARY}
                  >
                    Back
                  </button>
                </div>
              </form>
            )}

            {step === "done" && done && (
              <div className="p-6">
                <h2 className={MODAL_H2}>Welcome to the club</h2>
                <p className="mt-2 font-sans text-sm text-stone-600">
                  You&rsquo;re logged in as{" "}
                  <strong className="font-mono">{done.username}</strong>.
                  {done.kids.length > 0 && (
                    <>
                      {" "}
                      Student logins created:{" "}
                      <strong className="font-mono">{done.kids.join(", ")}</strong> —
                      they log in with the passwords you just chose.
                    </>
                  )}
                </p>
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className={`w-full ${BTN_PRIMARY}`}
                  >
                    Start reading
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      );

  return (
    <>
      <button type="button" onClick={openModal} className={className}>
        Join
      </button>
      {modal}
    </>
  );
}
