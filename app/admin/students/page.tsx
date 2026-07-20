import { currentUser, isAdmin, isOwner } from "@/lib/auth";
import { listStudents, listTeachers, type PublicUser } from "@/lib/users";
import { loadSessions } from "@/lib/sessions";
import StudentRoster, {
  type Classroom,
  type RosterEntry,
} from "@/components/StudentRoster";

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
        <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
          Students
        </h1>
        <p className="mt-4 border-[3px] border-[#0a0a0a] bg-[#ffe600] px-4 py-3 font-sans text-sm font-bold text-[#0a0a0a]">
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
        <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
          Students
        </h1>
        <p className="mt-4 border-[3px] border-[#0a0a0a] bg-stone-100 px-4 py-3 font-sans text-sm text-stone-600">
          This page is for teachers. Your scores are on the{" "}
          <a href="/admin" className="font-bold underline">
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
      // A live/paused attempt (the in-progress slot) isn't a finished attempt
      // yet — it becomes one when the student Ends (or Cancels) it.
      if (s.inProgress) continue;
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

  // The owner also SEES every other teacher's classroom. It may ADD a student to
  // any of them (the /api/students POST lets the owner target a teacherId), but
  // Rename/Reset stay own-classroom (the /api/students/[username] route still
  // ownership-checks and doesn't exempt the owner). A regular teacher, and a
  // lone owner with no other teachers, manages just their own classroom
  // (unchanged).
  const teachers = isOwner(user) ? await listTeachers() : [];
  const others = teachers.filter((t) => t.username !== user);

  if (others.length === 0) {
    return (
      <div>
        <StudentRoster students={ownRoster} teacherName={user} />
      </div>
    );
  }

  // Owner + other teachers → ONE unified roster with a Teacher column (the
  // Scores-page recipe — the per-classroom tabs were dropped as inefficient):
  // own students first (fully editable), then each other teacher's (visible,
  // addable-to via the modal's classroom selector, but not Rename/Reset).
  const self = teachers.find((t) => t.username === user);
  const otherRosters = await Promise.all(
    others.map(async (t) => ({
      teacher: t,
      students: toRoster(await listStudents(t.username)),
    }))
  );
  const unified: RosterEntry[] = [
    ...ownRoster.map((s) => ({
      ...s,
      teacherName: self?.displayName ?? user,
      canManage: true,
    })),
    ...otherRosters.flatMap(({ teacher, students }) =>
      students.map((s) => ({
        ...s,
        teacherName: teacher.displayName,
        canManage: false,
      }))
    ),
  ];
  const classrooms: Classroom[] = [
    { teacherId: user, label: "My classroom" },
    ...others.map((t) => ({
      teacherId: t.username,
      label: `${t.displayName}’s classroom`,
    })),
  ];

  return (
    <div>
      <StudentRoster
        students={unified}
        teacherName={user}
        title="Manage students"
        subtitle="Every classroom in one list. You can add a student to any classroom; renaming and password resets stay with each classroom's own teacher."
        showTeacher
        classrooms={classrooms}
      />
    </div>
  );
}
