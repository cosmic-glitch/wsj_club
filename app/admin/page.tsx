import { list } from "@vercel/blob";
import { currentUser, isAdmin } from "@/lib/auth";
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

async function loadSessions(): Promise<Session[] | { error: string }> {
  try {
    const { blobs } = await list({ prefix: "quiz-sessions/" });
    // Audio recordings (.webm/.mp4) live in the SAME prefix as the session
    // JSON, so only fetch/parse the .json files — never try to JSON.parse a
    // recording. Each parse is independently guarded too, so one corrupt blob
    // can't take down the whole page (returns null → filtered out).
    const sessions = (
      await Promise.all(
        blobs
          .filter((b) => b.pathname.endsWith(".json"))
          .map(async (b) => {
            try {
              const res = await fetch(b.url, { cache: "no-store" });
              const session = (await res.json()) as Session;
              return { ...session, blobUrl: b.url };
            } catch (err) {
              console.error("Skipping unreadable session blob:", b.pathname, err);
              return null;
            }
          })
      )
    ).filter((s): s is Session => s !== null);
    return sessions;
  } catch (err) {
    console.error("Loading quiz sessions failed:", err);
    return { error: "Could not load sessions (is Blob storage configured?)." };
  }
}

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

  // The teacher (admin) sees every student's attempts; a student sees only their
  // own. Delete stays teacher-only (the route is admin-gated regardless).
  const admin = isAdmin(user);
  const result = await loadSessions();

  // For a student, filter to their OWN attempts *on the server* so another
  // student's sessions never reach the browser. Match on loginUser (the real
  // login), falling back to studentName for older sessions that predate it.
  // Cancelled attempts are teacher-only — a student never sees them, even
  // their own (they were told a cancelled quiz "won't count").
  const visible =
    "error" in result || admin
      ? result
      : result.filter(
          (s) => !s.cancelled && (s.loginUser ?? s.studentName) === user
        );

  const heading = admin ? "Quiz sessions" : "Your scores";
  const subtitle = admin
    ? "Saved voice-quiz attempts by article — click any attempt for its full report card, recording, and transcript."
    : "Your saved voice-quiz attempts — click any attempt for its full report card, recording, and transcript.";

  return (
    <div>
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
