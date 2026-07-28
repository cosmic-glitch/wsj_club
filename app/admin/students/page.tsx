import { currentUser, isAdmin, isOwner } from "@/lib/auth";
import { listStudents, listParents, type PublicUser } from "@/lib/users";
import { loadSessions } from "@/lib/sessions";
import StudentRoster, {
  type Classroom,
  type RosterEntry,
} from "@/components/StudentRoster";

// Reads cookies + Blob at request time — never static.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Students · Daily Reading Club",
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
          Please log in (top right) to manage your students.
        </p>
      </div>
    );
  }

  // Parent-only. A logged-in student who navigates here directly is sent back
  // to their scores.
  if (!(await isAdmin(user))) {
    return (
      <div>
        <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
          Students
        </h1>
        <p className="mt-4 border-[3px] border-[#0a0a0a] bg-stone-100 px-4 py-3 font-sans text-sm text-stone-600">
          This page is for parents. Your scores are on the{" "}
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
  const stats = new Map<
    string,
    { attempts: number; lastActiveIso: string | null; scoreSum: number; scoreCount: number }
  >();
  const result = await loadSessions();
  if (!("error" in result)) {
    for (const s of result) {
      // A live/paused attempt (the in-progress slot) isn't a finished attempt
      // yet — it becomes one when the student Ends (or Cancels) it.
      if (s.inProgress) continue;
      const owner = s.loginUser ?? s.studentName ?? "";
      if (!owner) continue;
      const cur =
        stats.get(owner) ?? { attempts: 0, lastActiveIso: null, scoreSum: 0, scoreCount: 0 };
      cur.attempts += 1;
      if (s.endedAt && (!cur.lastActiveIso || s.endedAt > cur.lastActiveIso)) {
        cur.lastActiveIso = s.endedAt;
      }
      // Average only graded "X/10" scores — cancelled attempts and the "—" of a
      // no-answers card carry no number and stay out of the denominator.
      const m = s.report?.score?.match(/(-?\d+(?:\.\d+)?)\s*\/\s*10/);
      if (m) {
        cur.scoreSum += parseFloat(m[1]);
        cur.scoreCount += 1;
      }
      stats.set(owner, cur);
    }
  }

  // Only active students are shown/managed for now (there's no deactivate/
  // reactivate in the UI — parents can add, rename, and reset passwords).
  const toRoster = (students: PublicUser[]): RosterEntry[] =>
    students
      .filter((s) => s.active !== false)
      .map((s) => {
        const st = stats.get(s.username);
        return {
          username: s.username,
          displayName: s.displayName,
          active: s.active !== false,
          attempts: st?.attempts ?? 0,
          lastActiveIso: st?.lastActiveIso ?? null,
          avgScore: st && st.scoreCount > 0 ? st.scoreSum / st.scoreCount : null,
        };
      });

  const ownRoster = toRoster(await listStudents(user));

  // The owner also SEES every other parent's classroom. It may ADD a student to
  // any of them (the /api/students POST lets the owner target a parentId), but
  // Rename/Reset stay own-classroom (the /api/students/[username] route still
  // ownership-checks and doesn't exempt the owner). A regular parent, and a
  // lone owner with no other parents, manages just their own students
  // (unchanged).
  const parents = isOwner(user) ? await listParents() : [];
  const others = parents.filter((p) => p.username !== user);

  if (others.length === 0) {
    return (
      <div>
        <StudentRoster students={ownRoster} parentUsername={user} />
      </div>
    );
  }

  // Owner + other parents → ONE unified roster with a Parent column (the
  // Scores-page recipe — the per-classroom tabs were dropped as inefficient):
  // own students first (fully editable), then each other parent's (visible,
  // addable-to via the modal's classroom selector, but not Rename/Reset).
  const self = parents.find((p) => p.username === user);
  const otherRosters = await Promise.all(
    others.map(async (p) => ({
      parent: p,
      students: toRoster(await listStudents(p.username)),
    }))
  );
  const unified: RosterEntry[] = [
    ...ownRoster.map((s) => ({
      ...s,
      parentName: self?.displayName ?? user,
      canManage: true,
    })),
    ...otherRosters.flatMap(({ parent, students }) =>
      students.map((s) => ({
        ...s,
        parentName: parent.displayName,
        canManage: false,
      }))
    ),
  ];
  const classrooms: Classroom[] = [
    { parentId: user, label: "My students" },
    ...others.map((p) => ({
      parentId: p.username,
      label: `${p.displayName}’s students`,
    })),
  ];

  return (
    <div>
      <StudentRoster
        students={unified}
        parentUsername={user}
        title="Manage students"
        subtitle="Every family's students in one list. You can add a student under any parent; renaming and password resets stay with each student's own parent."
        showParent
        classrooms={classrooms}
      />
    </div>
  );
}
