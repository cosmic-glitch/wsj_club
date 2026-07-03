import { currentUser, isAdmin } from "@/lib/auth";
import { listStudents } from "@/lib/users";
import { loadSessions } from "@/lib/sessions";
import StudentRoster, { type RosterEntry } from "@/components/StudentRoster";

// Reads cookies + Blob at request time — never static.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Students · WSJ Reading Club",
};

export default async function StudentsPage() {
  const user = await currentUser();

  if (!user) {
    return (
      <div>
        <h1 className="font-serif text-3xl font-bold text-stone-900">Students</h1>
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Please log in (top right) to manage your classroom.
        </p>
      </div>
    );
  }

  // Teacher-only. A logged-in student who navigates here directly is sent back
  // to their scores.
  if (!(await isAdmin(user))) {
    return (
      <div>
        <h1 className="font-serif text-3xl font-bold text-stone-900">Students</h1>
        <p className="mt-4 rounded-lg bg-stone-100 px-4 py-3 text-sm text-stone-600">
          This page is for teachers. Your scores are on the{" "}
          <a href="/admin" className="underline">
            Scores
          </a>{" "}
          page.
        </p>
      </div>
    );
  }

  // Only active students are shown/managed for now (there's no deactivate/
  // reactivate in the UI — teachers can add, rename, and reset passwords).
  const students = (await listStudents(user)).filter((s) => s.active !== false);

  // Per-student stats (attempts + last active) from the saved sessions, so the
  // roster shows activity at a glance. Best-effort: a load error just yields
  // zero-stat rows rather than blanking the page.
  const stats = new Map<string, { attempts: number; lastActiveIso: string | null }>();
  const result = await loadSessions();
  if (!("error" in result)) {
    for (const s of result) {
      const owner = s.loginUser ?? s.studentName ?? "";
      if (!owner) continue;
      const cur = stats.get(owner) ?? { attempts: 0, lastActiveIso: null };
      cur.attempts += 1;
      if (s.endedAt && (!cur.lastActiveIso || s.endedAt > cur.lastActiveIso)) {
        cur.lastActiveIso = s.endedAt;
      }
      stats.set(owner, cur);
    }
  }

  const roster: RosterEntry[] = students.map((s) => ({
    username: s.username,
    displayName: s.displayName,
    active: s.active !== false,
    attempts: stats.get(s.username)?.attempts ?? 0,
    lastActiveIso: stats.get(s.username)?.lastActiveIso ?? null,
  }));

  return (
    <div>
      <StudentRoster students={roster} teacherName={user} />
    </div>
  );
}
