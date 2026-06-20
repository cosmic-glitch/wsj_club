import { list } from "@vercel/blob";
import { currentUser, isAdmin, adminConfigured } from "@/lib/auth";
import { dateBig } from "@/lib/content";
import AdminSessions, {
  type Session,
  type ArticleGroup,
} from "@/components/AdminSessions";

// Reads cookies + Blob at request time — never static.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Quiz sessions · WSJ Reading Club",
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

  // Teacher-only. Students can log in for the voice quiz but never reach here.
  if (!isAdmin(user)) {
    const message = !user
      ? "Please log in (top right) as a teacher to view saved quiz sessions."
      : !adminConfigured()
        ? "This page is teacher-only, but no teachers are configured yet. Set the ADMIN_USERS env var to your username (comma-separated for more than one) and redeploy."
        : "This page is for teachers only.";
    return (
      <div>
        <h1 className="font-serif text-3xl font-bold text-stone-900">Quiz sessions</h1>
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {message}
        </p>
      </div>
    );
  }

  const result = await loadSessions();

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-stone-900">Quiz sessions</h1>
      <p className="mt-1 text-sm text-stone-500">
        Saved voice-quiz attempts by article — click any attempt for its full
        report card, recording, and transcript.
      </p>

      {"error" in result ? (
        <p className="mt-6 rounded-lg bg-stone-100 px-4 py-3 text-sm text-stone-600">
          {result.error}
        </p>
      ) : result.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">
          No quiz sessions yet.
        </p>
      ) : (
        <AdminSessions groups={groupByArticle(result)} />
      )}
    </div>
  );
}
