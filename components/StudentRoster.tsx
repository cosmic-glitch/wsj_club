"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type RosterEntry = {
  username: string;
  displayName: string;
  active: boolean;
  attempts: number;
  // Mean of the student's graded "X/10" scores, null when nothing is graded yet.
  avgScore: number | null;
  lastActiveIso: string | null;
  // Owner's unified all-classrooms view: the parent's display name (the Parent
  // column) and whether the viewer may Rename/Reset this row (only the owner's
  // own students — the PATCH route ownership-checks and doesn't exempt the
  // owner). Absent on a single-classroom roster.
  parentName?: string;
  canManage?: boolean;
};

// A classroom the Add-student modal can target (owner's unified view).
export type Classroom = { parentId: string; label: string };

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

/* ------------------------------- sorting -------------------------------- */

type SortKey = "username" | "parent" | "attempts" | "avgScore" | "lastActive";
type SortDir = "asc" | "desc";

// First click on a header: text columns start ascending, the numeric/recency
// ones start with the most first.
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  username: "asc",
  parent: "asc",
  attempts: "desc",
  avgScore: "desc",
  lastActive: "desc",
};

function compareBy(key: SortKey, a: RosterEntry, b: RosterEntry): number {
  switch (key) {
    case "username":
      return a.username.localeCompare(b.username);
    case "parent":
      return (
        (a.parentName ?? "").localeCompare(b.parentName ?? "") ||
        a.username.localeCompare(b.username)
      );
    case "attempts":
      return a.attempts - b.attempts || a.username.localeCompare(b.username);
    case "avgScore":
      // Ungraded rows (null) sort as the lowest.
      return (
        (a.avgScore ?? -1) - (b.avgScore ?? -1) ||
        a.username.localeCompare(b.username)
      );
    case "lastActive":
      // Never-active rows (null ISO) sort as the oldest.
      return (
        (a.lastActiveIso ?? "").localeCompare(b.lastActiveIso ?? "") ||
        a.username.localeCompare(b.username)
      );
  }
}

export default function StudentRoster({
  students,
  parentUsername,
  title = "My students",
  subtitle = "The students you manage. Add a student to give them a login for the voice quiz.",
  readOnly = false,
  canAdd,
  showTitle = true,
  showParent = false,
  classrooms,
}: {
  students: RosterEntry[];
  parentUsername: string;
  title?: string;
  subtitle?: string;
  // When true, the Rename/Reset row actions are hidden table-wide — those stay
  // own-classroom for everyone (the /api/students/[username] route
  // ownership-checks and doesn't exempt the owner). Adding is controlled
  // separately by `canAdd`. In the owner's unified view the table is NOT
  // readOnly — per-row `canManage` gates the actions instead.
  readOnly?: boolean;
  // Whether the Add-student button shows. Defaults to `!readOnly`.
  canAdd?: boolean;
  // When false, the big <h1> is dropped, leaving just the subtitle + Add button.
  showTitle?: boolean;
  // Owner's unified all-classrooms view: adds a Parent column (each row's
  // `parentName`) — mirrors the Scores page's unified table.
  showParent?: boolean;
  // When set (2+ classrooms — the owner), the Add-student modal shows a
  // parent selector so a student can be added under any parent; defaults to
  // `parentUsername` (the caller's own).
  classrooms?: Classroom[];
}) {
  const showAdd = canAdd ?? !readOnly;
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [credential, setCredential] = useState<Credential | null>(null);
  // The row currently being renamed inline, and a per-row busy flag.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  // Column sort. Default: the Parent column on the owner's unified view (its
  // grouping column), Username on a single-classroom roster (no Parent column).
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: showParent ? "parent" : "username",
    dir: "asc",
  });

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: DEFAULT_DIR[key] }
    );
  }

  const sorted = [...students].sort((a, b) => {
    const c = compareBy(sort.key, a, b);
    return sort.dir === "asc" ? c : -c;
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          {showTitle && (
            <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
              {title}
            </h1>
          )}
          <p className={`${showTitle ? "mt-2 " : ""}font-sans text-[13px] text-stone-500`}>
            {subtitle}
          </p>
        </div>
        {showAdd && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="shrink-0 border-2 border-[#0a0a0a] bg-[#0a0a0a] px-4 py-2 font-mono text-sm font-bold uppercase tracking-[.06em] text-[#ffe600] transition hover:bg-[#ffe600] hover:text-[#0a0a0a]"
          >
            + Add student
          </button>
        )}
      </div>

      {students.length === 0 ? (
        <p className="mt-6 border-[3px] border-dashed border-[#0a0a0a] bg-white p-8 text-center font-mono text-sm font-bold uppercase tracking-[.08em] text-stone-500">
          {showAdd
            ? "No students yet. Add your first student to get started."
            : "No students in this classroom yet."}
        </p>
      ) : (
        <div className="mt-6 overflow-hidden border-[3px] border-[#0a0a0a] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0a0a0a] text-left font-mono text-[10px] font-bold uppercase tracking-[.12em] text-white">
                <SortHeader label="Username" k="username" sort={sort} onSort={toggleSort} />
                {showParent && (
                  <SortHeader label="Parent" k="parent" sort={sort} onSort={toggleSort} />
                )}
                <SortHeader
                  label="Attempts"
                  k="attempts"
                  sort={sort}
                  onSort={toggleSort}
                  align="right"
                />
                <SortHeader
                  label="Avg score"
                  k="avgScore"
                  sort={sort}
                  onSort={toggleSort}
                  align="right"
                />
                <SortHeader label="Last active" k="lastActive" sort={sort} onSort={toggleSort} />
                {!readOnly && <th className="px-4 py-2.5 text-right font-bold">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-[#0a0a0a]">
              {sorted.map((s) => (
                <StudentRow
                  key={s.username}
                  student={s}
                  readOnly={readOnly}
                  showParent={showParent}
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
          parentUsername={parentUsername}
          classrooms={classrooms}
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

/* --------------------------- sortable header ---------------------------- */

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  align?: "right";
}) {
  const active = sort.key === k;
  return (
    <th
      className={`px-4 py-2.5 font-bold ${align === "right" ? "text-right" : ""}`}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 uppercase tracking-[.12em] transition hover:text-[#ffe600]"
      >
        {label}
        <span aria-hidden className={active ? "" : "opacity-30"}>
          {active && sort.dir === "desc" ? "▼" : "▲"}
        </span>
      </button>
    </th>
  );
}

/* ------------------------------- one row -------------------------------- */

function StudentRow({
  student,
  readOnly,
  showParent,
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
  showParent: boolean;
  renaming: boolean;
  busy: boolean;
  onStartRename: () => void;
  onStopRename: () => void;
  setBusy: (b: boolean) => void;
  onCredential: (c: Credential) => void;
  refresh: () => void;
}) {
  // Row-level Rename/Reset: the table must allow actions AND the row must be
  // manageable by the viewer (in the owner's unified view, only own students).
  const editable = !readOnly && student.canManage !== false;
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
        {renaming && editable ? (
          <span className="flex items-center gap-2">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename();
                if (e.key === "Escape") onStopRename();
              }}
              className="w-32 border-2 border-[#0a0a0a] px-2 py-1 text-sm focus:bg-[#fffbd6] focus:outline-none"
            />
            <button
              type="button"
              onClick={saveRename}
              disabled={busy}
              className="font-mono text-[11px] font-bold uppercase tracking-[.06em] text-[#0a0a0a] hover:bg-[#ffe600] disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onStopRename}
              className="font-mono text-[11px] font-bold uppercase tracking-[.06em] text-stone-500 hover:bg-[#0a0a0a] hover:text-[#ffe600]"
            >
              Cancel
            </button>
          </span>
        ) : (
          <span className="font-mono font-medium text-stone-900">
            {student.username}
            {!student.active && (
              <span className="ml-2 bg-stone-200 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-stone-500">
                inactive
              </span>
            )}
          </span>
        )}
      </td>
      {showParent && (
        <td className="px-4 py-3 text-stone-600">{student.parentName ?? "—"}</td>
      )}
      <td className="px-4 py-3 text-right tabular-nums text-stone-600">
        {student.attempts}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-stone-600">
        {student.avgScore == null ? "—" : student.avgScore.toFixed(1)}
      </td>
      <td className="px-4 py-3 text-stone-500">{lastActive}</td>
      {!readOnly && (
        <td className="px-4 py-3">
          {!renaming && editable && (
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onStartRename}
                disabled={busy}
                className="font-mono text-[11px] font-bold uppercase tracking-[.06em] text-[#0a0a0a] hover:bg-[#ffe600] disabled:opacity-50"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={resetPassword}
                disabled={busy}
                className="font-mono text-[11px] font-bold uppercase tracking-[.06em] text-[#0a0a0a] hover:bg-[#ffe600] disabled:opacity-50"
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
  parentUsername,
  classrooms,
  onClose,
  onCreated,
}: {
  parentUsername: string;
  classrooms?: Classroom[];
  onClose: () => void;
  onCreated: (c: Credential) => void;
}) {
  // Which parent the new student belongs to. Only the owner sees a choice
  // (2+ classrooms); everyone else adds to their own.
  const [parentId, setParentId] = useState(parentUsername);
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

  // Auto-suggest the username from the display name until the parent edits it.
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
        // parentId names the parent to add under. The server forces it to the
        // caller for a regular parent; only the owner may target another one.
        body: JSON.stringify({ displayName, username, password, parentId }),
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
    displayName.trim() && username.trim().length >= 3 && password.length > 0 && avail !== "taken";

  return (
    <Modal onClose={onClose} title="Add a student">
      <form onSubmit={submit} className="space-y-4">
        {classrooms && classrooms.length > 1 && (
          <label className="block">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-stone-500">
              Parent
            </span>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="mt-1 w-full border-2 border-[#0a0a0a] bg-white px-3 py-2 text-sm focus:bg-[#fffbd6] focus:outline-none"
            >
              {classrooms.map((c) => (
                <option key={c.parentId} value={c.parentId}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-stone-500">
            Display name
          </span>
          <input
            value={displayName}
            onChange={(e) => onDisplayName(e.target.value)}
            autoFocus
            placeholder="Anusha"
            className="mt-1 w-full border-2 border-[#0a0a0a] px-3 py-2 text-sm focus:bg-[#fffbd6] focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-stone-500">
            Username
          </span>
          <input
            value={username}
            onChange={(e) => {
              setUsernameEdited(true);
              setUsername(e.target.value.toLowerCase());
            }}
            placeholder="anusha"
            autoComplete="off"
            className="mt-1 w-full border-2 border-[#0a0a0a] px-3 py-2 font-mono text-sm focus:bg-[#fffbd6] focus:outline-none"
          />
          <span className="mt-1 block font-mono text-xs">
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
          <span className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-stone-500">
            Password
          </span>
          <div className="mt-1 flex gap-2">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border-2 border-[#0a0a0a] px-3 py-2 font-mono text-sm focus:bg-[#fffbd6] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              className="shrink-0 border-2 border-[#0a0a0a] bg-white px-3 py-2 font-mono text-xs font-bold uppercase tracking-[.06em] text-[#0a0a0a] transition hover:bg-[#ffe600]"
            >
              Generate
            </button>
          </div>
        </label>

        {error && <p className="text-sm font-bold text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-[#0a0a0a] bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-[.06em] text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-[#ffe600]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="border-2 border-[#0a0a0a] bg-[#0a0a0a] px-4 py-2 font-mono text-xs font-bold uppercase tracking-[.06em] text-[#ffe600] transition enabled:hover:bg-[#ffe600] enabled:hover:text-[#0a0a0a] disabled:opacity-50"
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
      <div className="mt-4 space-y-2 border-2 border-[#0a0a0a] bg-[#fffbd6] p-4">
        <CopyRow label="Username" value={credential.username} />
        <CopyRow label="Password" value={credential.password} />
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="border-2 border-[#0a0a0a] bg-[#0a0a0a] px-4 py-2 font-mono text-xs font-bold uppercase tracking-[.06em] text-[#ffe600] transition hover:bg-[#ffe600] hover:text-[#0a0a0a]"
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
      <span className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-stone-500">
        {label}
      </span>
      <span className="flex items-center gap-2">
        <code className="font-mono text-sm font-bold text-[#0a0a0a]">{value}</code>
        <button
          type="button"
          onClick={copy}
          className="border-2 border-[#0a0a0a] bg-white px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[.06em] text-[#0a0a0a] transition hover:bg-[#ffe600]"
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border-[3px] border-[#0a0a0a] bg-white p-6 shadow-[8px_8px_0_#ffe600,8px_8px_0_3px_#0a0a0a]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-normal uppercase text-[#0a0a0a]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="px-1 text-stone-400 transition hover:bg-[#0a0a0a] hover:text-[#ffe600]"
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
