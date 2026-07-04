"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type RosterEntry = {
  username: string;
  displayName: string;
  active: boolean;
  attempts: number;
  lastActiveIso: string | null;
};

// Kid-friendly memorable passwords, generated client-side (the server only ever
// receives + hashes them). e.g. "brave-otter-42".
const ADJ = "brave bright calm clever eager gentle happy jolly kind lucky merry proud quick sunny witty".split(" ");
const ANIMAL = "otter panda koala lynx robin finch heron ibis tiger zebra moth wren seal hare fox".split(" ");
function generatePassword(): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  const n = Math.floor(Math.random() * 90) + 10; // 10–99
  return `${pick(ADJ)}-${pick(ANIMAL)}-${n}`;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 32);
}

type Credential = { username: string; password: string; reset: boolean };

export default function StudentRoster({
  students,
  teacherName,
  title = "My classroom",
  subtitle = "The students you manage. Add a student to give them a login for the voice quiz.",
  readOnly = false,
}: {
  students: RosterEntry[];
  teacherName: string;
  title?: string;
  subtitle?: string;
  // When true (the owner viewing ANOTHER teacher's classroom), the roster is
  // view-only: no Add button and no Rename/Reset row actions. The /api/students*
  // routes ownership-check every mutation and don't exempt the owner, so hiding
  // the controls here matches what the owner is actually allowed to do.
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [credential, setCredential] = useState<Credential | null>(null);
  // The row currently being renamed inline, and a per-row busy flag.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-stone-900">{title}</h1>
          <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="shrink-0 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700"
          >
            + Add student
          </button>
        )}
      </div>

      {students.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">
          {readOnly
            ? "No students in this classroom yet."
            : "No students yet. Add your first student to get started."}
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="px-4 py-2 font-medium">Student</th>
                <th className="px-4 py-2 font-medium">Username</th>
                <th className="px-4 py-2 text-right font-medium">Attempts</th>
                <th className="px-4 py-2 font-medium">Last active</th>
                {!readOnly && <th className="px-4 py-2 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {students.map((s) => (
                <StudentRow
                  key={s.username}
                  student={s}
                  readOnly={readOnly}
                  renaming={renaming === s.username}
                  busy={busyRow === s.username}
                  onStartRename={() => setRenaming(s.username)}
                  onStopRename={() => setRenaming(null)}
                  setBusy={(b) => setBusyRow(b ? s.username : null)}
                  onCredential={setCredential}
                  refresh={() => router.refresh()}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <AddStudentModal
          teacherName={teacherName}
          onClose={() => setAddOpen(false)}
          onCreated={(cred) => {
            setAddOpen(false);
            setCredential(cred);
          }}
        />
      )}

      {credential && (
        <CredentialModal
          credential={credential}
          onClose={() => {
            setCredential(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------- one row -------------------------------- */

function StudentRow({
  student,
  readOnly,
  renaming,
  busy,
  onStartRename,
  onStopRename,
  setBusy,
  onCredential,
  refresh,
}: {
  student: RosterEntry;
  readOnly: boolean;
  renaming: boolean;
  busy: boolean;
  onStartRename: () => void;
  onStopRename: () => void;
  setBusy: (b: boolean) => void;
  onCredential: (c: Credential) => void;
  refresh: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [draftName, setDraftName] = useState(student.displayName);
  useEffect(() => setMounted(true), []);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/students/${student.username}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "That didn't work.");
        return false;
      }
      return true;
    } catch {
      alert("That didn't work.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveRename() {
    const name = draftName.trim();
    if (!name || name === student.displayName) {
      onStopRename();
      return;
    }
    if (await patch({ action: "rename", displayName: name })) {
      onStopRename();
      refresh();
    }
  }

  async function resetPassword() {
    if (
      !confirm(
        `Reset ${student.displayName}'s password? Their current password will stop working.`
      )
    )
      return;
    const password = generatePassword();
    if (await patch({ action: "resetPassword", password })) {
      onCredential({ username: student.username, password, reset: true });
    }
  }

  const lastActive =
    student.lastActiveIso == null
      ? "—"
      : mounted
        ? new Date(student.lastActiveIso).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : student.lastActiveIso.slice(0, 10);

  return (
    <tr className={student.active ? "" : "bg-stone-50 text-stone-400"}>
      <td className="px-4 py-3">
        {renaming && !readOnly ? (
          <span className="flex items-center gap-2">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename();
                if (e.key === "Escape") onStopRename();
              }}
              className="w-32 rounded border border-stone-300 px-2 py-1 text-sm focus:border-stone-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={saveRename}
              disabled={busy}
              className="text-xs font-medium text-stone-900 hover:underline disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onStopRename}
              className="text-xs text-stone-500 hover:underline"
            >
              Cancel
            </button>
          </span>
        ) : (
          <span className="font-medium text-stone-900">
            {student.displayName}
            {!student.active && (
              <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-500">
                inactive
              </span>
            )}
          </span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-stone-500">{student.username}</td>
      <td className="px-4 py-3 text-right tabular-nums text-stone-600">
        {student.attempts}
      </td>
      <td className="px-4 py-3 text-stone-500">{lastActive}</td>
      {!readOnly && (
        <td className="px-4 py-3">
          {!renaming && (
            <div className="flex justify-end gap-3 text-xs">
              <button
                type="button"
                onClick={onStartRename}
                disabled={busy}
                className="text-stone-500 hover:text-stone-900 disabled:opacity-50"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={resetPassword}
                disabled={busy}
                className="text-stone-500 hover:text-stone-900 disabled:opacity-50"
              >
                Reset password
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

/* --------------------------- add-student modal --------------------------- */

function AddStudentModal({
  teacherName,
  onClose,
  onCreated,
}: {
  teacherName: string;
  onClose: () => void;
  onCreated: (c: Credential) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [password, setPassword] = useState(() => generatePassword());
  const [avail, setAvail] = useState<"idle" | "checking" | "free" | "taken" | "invalid">(
    "idle"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-suggest the username from the display name until the teacher edits it.
  function onDisplayName(v: string) {
    setDisplayName(v);
    if (!usernameEdited) setUsername(slugify(v));
  }

  // Live uniqueness check (debounced).
  useEffect(() => {
    const u = username.trim().toLowerCase();
    if (debounce.current) clearTimeout(debounce.current);
    if (u.length < 3) {
      setAvail(u.length === 0 ? "idle" : "invalid");
      return;
    }
    setAvail("checking");
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/students?username=${encodeURIComponent(u)}`);
        const d = await res.json();
        setAvail(d.available ? "free" : d.reason === "invalid" ? "invalid" : "taken");
      } catch {
        setAvail("idle");
      }
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [username]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, username, password }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not create student.");
        if (d.code === "username-taken") setAvail("taken");
        return;
      }
      onCreated({ username: username.trim().toLowerCase(), password, reset: false });
    } catch {
      setError("Could not create student.");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    displayName.trim() && username.trim().length >= 3 && password.length >= 4 && avail !== "taken";

  return (
    <Modal onClose={onClose} title="Add a student">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-xs font-medium text-stone-500">Display name</span>
          <input
            value={displayName}
            onChange={(e) => onDisplayName(e.target.value)}
            autoFocus
            placeholder="Anusha"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-stone-500">Username</span>
          <input
            value={username}
            onChange={(e) => {
              setUsernameEdited(true);
              setUsername(e.target.value.toLowerCase());
            }}
            placeholder="anusha"
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm focus:border-stone-500 focus:outline-none"
          />
          <span className="mt-1 block text-xs">
            {avail === "checking" && <span className="text-stone-400">Checking…</span>}
            {avail === "free" && <span className="text-green-600">✓ available</span>}
            {avail === "taken" && (
              <span className="text-red-600">✗ that username is taken</span>
            )}
            {avail === "invalid" && (
              <span className="text-stone-400">
                3–32 chars: lowercase letters, numbers, - or _
              </span>
            )}
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-stone-500">Password</span>
          <div className="mt-1 flex gap-2">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm focus:border-stone-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-600 transition hover:bg-stone-50"
            >
              Generate
            </button>
          </div>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-stone-600 transition hover:bg-stone-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-stone-700 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create student"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------- credential reveal --------------------------- */

function CredentialModal({
  credential,
  onClose,
}: {
  credential: Credential;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} title={credential.reset ? "Password reset" : "Student created"}>
      <p className="text-sm text-stone-600">
        Give {credential.reset ? "them" : "the student"} these credentials — the
        password <strong>won&apos;t be shown again</strong>:
      </p>
      <div className="mt-4 space-y-2 rounded-lg bg-stone-50 p-4">
        <CopyRow label="Username" value={credential.username} />
        <CopyRow label="Password" value={credential.password} />
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the value is visible to copy by hand */
    }
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-stone-500">{label}</span>
      <span className="flex items-center gap-2">
        <code className="font-mono text-sm text-stone-900">{value}</code>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-stone-300 px-2 py-0.5 text-xs text-stone-600 transition hover:bg-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </span>
    </div>
  );
}

/* ------------------------------- modal shell ---------------------------- */

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-xl font-bold text-stone-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 transition hover:text-stone-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
