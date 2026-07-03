import { currentUser, isAdmin } from "@/lib/auth";
import { listStudents } from "@/lib/users";
import { loadSessions } from "@/lib/sessions";
import { dateBig } from "@/lib/content";
import AdminTabs from "@/components/AdminTabs";
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

  // A teacher (admin) sees their OWN classroom's attempts; a student sees only
  // their own. Delete stays teacher-only (the route is admin-gated + ownership-
  // checked regardless).
  const admin = await isAdmin(user);
  const result = await loadSessions();

  // Scope the visible sessions *on the server* so another classroom's (or
  // another student's) sessions never reach the browser.
  //   - Teacher: their students' attempts + their own — matched by the stamped
  //     teacherId, falling back to roster membership by loginUser for older
  //     sessions saved before teacherId existed. Cancelled attempts stay visible
  //     to the teacher.
  //   - Student: only their own, and never a cancelled one (they were told a
  //     cancelled quiz "won't count").
  let visible: typeof result;
  if ("error" in result) {
    visible = result;
  } else if (admin) {
    const roster = new Set((await listStudents(user!)).map((s) => s.username));
    roster.add(user!); // include the teacher's own attempts
    visible = result.filter((s) => {
      const owner = s.loginUser ?? s.studentName ?? "";
      return s.teacherId === user || roster.has(owner);
    });
  } else {
    visible = result.filter(
      (s) => !s.cancelled && (s.loginUser ?? s.studentName) === user
    );
  }

  const heading = admin ? "Quiz sessions" : "Your scores";
  const subtitle = admin
    ? "Saved voice-quiz attempts by article — click any attempt for its full report card, recording, and transcript."
    : "Your saved voice-quiz attempts — click any attempt for its full report card, recording, and transcript.";

  return (
    <div>
      {/* Teachers get tabs to their classroom management; students don't. */}
      {admin && <AdminTabs active="scores" />}
      <h1 className="font-serif text-3xl font-bold text-stone-900">{heading}</h1>
      <p className="mt-1 text-sm text-stone-500">{subtitle}</p>

      {"error" in visible ? (
        <p className="mt-6 rounded-lg bg-stone-100 px-4 py-3 text-sm text-stone-600">
          {visible.error}
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">
          {admin ? "No quiz sessions yet." : "You haven't taken any voice quizzes yet."}
        </p>
      ) : (
        <AdminSessions groups={groupByArticle(visible)} canDelete={admin} />
      )}
    </div>
  );
}
