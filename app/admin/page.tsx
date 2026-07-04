import { currentUser, isAdmin, isOwner } from "@/lib/auth";
import { listStudents, listTeachers } from "@/lib/users";
import { loadSessions } from "@/lib/sessions";
import { dateBig } from "@/lib/content";
import AdminSessions, {
  type Session,
  type ArticleGroup,
} from "@/components/AdminSessions";

// Reads cookies + Blob at request time — never static.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Scores · WSJ Reading Club",
};

/**
 * Group every saved session by its article (one table row per day), newest
 * article first, with attempts ordered chronologically within each article so
 * the "sequenced list" numbers them 1, 2, 3 in the order they were taken. The
 * date label is computed here (with the shared dateBig) because lib/content
 * can't be imported into the client component.
 */
function groupByArticle(sessions: Session[]): ArticleGroup[] {
  const byDate = new Map<string, ArticleGroup>();
  for (const s of sessions) {
    let g = byDate.get(s.date);
    if (!g) {
      g = { date: s.date, dateLabel: dateBig(s.date), title: s.title, attempts: [] };
      byDate.set(s.date, g);
    }
    g.attempts.push(s);
  }
  const groups = Array.from(byDate.values());
  groups.sort((a, b) => b.date.localeCompare(a.date));
  for (const g of groups) {
    g.attempts.sort((a, b) => (a.endedAt ?? "").localeCompare(b.endedAt ?? ""));
  }
  return groups;
}

/**
 * Scope a session list to one teacher's classroom: sessions stamped with that
 * teacherId, or (fallback for older sessions saved before teacherId existed)
 * whose owning student/teacher is in the roster. The roster includes the teacher
 * so their own attempts show too.
 */
function scopeToClassroom(
  sessions: Session[],
  teacher: string,
  roster: Set<string>
): Session[] {
  return sessions.filter((s) => {
    const owner = s.loginUser ?? s.studentName ?? "";
    return s.teacherId === teacher || roster.has(owner);
  });
}

/** One classroom's card: a labeled heading over its by-article attempts table. */
function ClassroomSection({
  label,
  groups,
  canDelete,
}: {
  label: string;
  groups: ArticleGroup[];
  canDelete: boolean;
}) {
  return (
    <section>
      <h2 className="font-serif text-xl font-bold text-stone-800">{label}</h2>
      {groups.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-stone-300 bg-white p-6 text-center text-sm text-stone-500">
          No quiz sessions yet.
        </p>
      ) : (
        <AdminSessions groups={groups} canDelete={canDelete} />
      )}
    </section>
  );
}

export default async function AdminPage() {
  const user = await currentUser();

  // Any logged-in user can see their scores; logged-out visitors can't.
  if (!user) {
    return (
      <div>
        <h1 className="font-serif text-3xl font-bold text-stone-900">Your scores</h1>
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Please log in (top right) to see your quiz scores and recordings.
        </p>
      </div>
    );
  }

  const admin = await isAdmin(user);
  const result = await loadSessions();

  if ("error" in result) {
    return (
      <div>
        <h1 className="font-serif text-3xl font-bold text-stone-900">
          {admin ? "Quiz sessions" : "Your scores"}
        </h1>
        <p className="mt-6 rounded-lg bg-stone-100 px-4 py-3 text-sm text-stone-600">
          {result.error}
        </p>
      </div>
    );
  }

  // A student sees only their own attempts, and never a cancelled one (they were
  // told a cancelled quiz "won't count"). Scoped on the server so another
  // student's data never reaches the browser.
  if (!admin) {
    const visible = result.filter(
      (s) => !s.cancelled && (s.loginUser ?? s.studentName) === user
    );
    return (
      <div>
        <h1 className="font-serif text-3xl font-bold text-stone-900">Your scores</h1>
        <p className="mt-1 text-sm text-stone-500">
          Your saved voice-quiz attempts — click any attempt for its full report
          card, recording, and transcript.
        </p>
        {visible.length === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">
            You haven&apos;t taken any voice quizzes yet.
          </p>
        ) : (
          <AdminSessions groups={groupByArticle(visible)} canDelete={false} />
        )}
      </div>
    );
  }

  // Build a scoped classroom (roster = the teacher's students + the teacher).
  // Only the caller's OWN classroom is deletable; the owner views others read-
  // only (the delete route ownership-checks regardless).
  async function classroomGroups(teacher: string): Promise<ArticleGroup[]> {
    const roster = new Set((await listStudents(teacher)).map((s) => s.username));
    roster.add(teacher);
    return groupByArticle(scopeToClassroom(result as Session[], teacher, roster));
  }

  // A regular teacher sees only their own classroom (unchanged: a single table).
  if (!isOwner(user)) {
    const groups = await classroomGroups(user);
    return (
      <div>
        <h1 className="font-serif text-3xl font-bold text-stone-900">Quiz sessions</h1>
        <p className="mt-1 text-sm text-stone-500">
          Saved voice-quiz attempts by article — click any attempt for its full
          report card, recording, and transcript.
        </p>
        {groups.length === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">
            No quiz sessions yet.
          </p>
        ) : (
          <AdminSessions groups={groups} canDelete={true} />
        )}
      </div>
    );
  }

  // The owner sees every classroom as its own section — their own first
  // (deletable), then each other teacher's (read-only).
  const others = (await listTeachers()).filter((t) => t.username !== user);
  const [ownGroups, otherSections] = await Promise.all([
    classroomGroups(user),
    Promise.all(
      others.map(async (t) => ({
        key: t.username,
        label: `${t.displayName}’s classroom`,
        groups: await classroomGroups(t.username),
      }))
    ),
  ]);

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-stone-900">Quiz sessions</h1>
      <p className="mt-1 text-sm text-stone-500">
        Every classroom — your own and each teacher&apos;s. Click any attempt for
        its full report card, recording, and transcript.
      </p>
      <div className="mt-8 space-y-10">
        <ClassroomSection label="My classroom" groups={ownGroups} canDelete={true} />
        {otherSections.map((sec) => (
          <ClassroomSection
            key={sec.key}
            label={sec.label}
            groups={sec.groups}
            canDelete={false}
          />
        ))}
      </div>
    </div>
  );
}
