import { currentUser, isAdmin, isOwner } from "@/lib/auth";
import { listStudents, listTeachers, type PublicUser } from "@/lib/users";
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

  // Per-student stats (attempts + last active) from the saved sessions, keyed by
  // username, so every roster shows activity at a glance. Best-effort: a load
  // error just yields zero-stat rows rather than blanking the page. Loaded once
  // and shared across all classrooms (the owner may render several).
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

  // Only active students are shown/managed for now (there's no deactivate/
  // reactivate in the UI — teachers can add, rename, and reset passwords).
  const toRoster = (students: PublicUser[]): RosterEntry[] =>
    students
      .filter((s) => s.active !== false)
      .map((s) => ({
        username: s.username,
        displayName: s.displayName,
        active: s.active !== false,
        attempts: stats.get(s.username)?.attempts ?? 0,
        lastActiveIso: stats.get(s.username)?.lastActiveIso ?? null,
      }));

  const ownRoster = toRoster(await listStudents(user));

  // A regular teacher manages just their own classroom (unchanged).
  if (!isOwner(user)) {
    return (
      <div>
        <StudentRoster students={ownRoster} teacherName={user} />
      </div>
    );
  }

  // The owner also SEES every other teacher's classroom, read-only (they manage
  // only their own — the /api/students* routes enforce that regardless).
  const others = (await listTeachers()).filter((t) => t.username !== user);
  const otherClassrooms = await Promise.all(
    others.map(async (t) => ({
      teacher: t,
      roster: toRoster(await listStudents(t.username)),
    }))
  );

  return (
    <div className="space-y-12">
      <StudentRoster students={ownRoster} teacherName={user} title="My classroom" />
      {otherClassrooms.map(({ teacher, roster }) => (
        <StudentRoster
          key={teacher.username}
          students={roster}
          teacherName={teacher.username}
          title={`${teacher.displayName}’s classroom`}
          subtitle={`Managed by ${teacher.displayName}. View only — you can see this classroom but only manage your own.`}
          readOnly
        />
      ))}
    </div>
  );
}
