import Link from "next/link";
import { list } from "@vercel/blob";
import { currentUser, isAdmin, adminConfigured } from "@/lib/auth";

// Reads cookies + Blob at request time — never static.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Quiz sessions · WSJ Reading Club",
};

type Turn = { role: "student" | "tutor"; text: string };
type Report = {
  score?: string;
  summary?: string;
  strengths?: string[];
  gaps?: string[];
  keyIdeas?: string;
  vocab?: string;
  concepts?: string;
};
type Session = {
  date: string;
  title: string;
  studentName: string;
  loginUser?: string;
  endedAt: string;
  transcript: Turn[];
  report: Report | null;
};

async function loadSessions(): Promise<Session[] | { error: string }> {
  try {
    const { blobs } = await list({ prefix: "quiz-sessions/" });
    const sessions = await Promise.all(
      blobs.map(async (b) => {
        const res = await fetch(b.url, { cache: "no-store" });
        return (await res.json()) as Session;
      })
    );
    // Newest first (by when the quiz ended).
    sessions.sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
    return sessions;
  } catch (err) {
    console.error("Loading quiz sessions failed:", err);
    return { error: "Could not load sessions (is Blob storage configured?)." };
  }
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
        Saved voice-quiz transcripts and report cards.
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
        <div className="mt-6 space-y-5">
          {result.map((s, i) => (
            <details
              key={i}
              className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-stone-900">
                    {s.studentName}
                    {s.report?.score && (
                      <span className="ml-2 font-bold text-sky-700">{s.report.score}</span>
                    )}
                  </span>
                  <span className="text-xs text-stone-400">
                    {s.endedAt ? new Date(s.endedAt).toLocaleString() : ""}
                  </span>
                </div>
                <p className="mt-1 text-sm text-stone-600">
                  <Link
                    href={`/reading/${s.date}`}
                    className="text-sky-700 hover:underline"
                  >
                    {s.title}
                  </Link>
                </p>
                {s.report?.summary && (
                  <p className="mt-1 text-sm text-stone-500">{s.report.summary}</p>
                )}
              </summary>

              {s.report && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {s.report.strengths && s.report.strengths.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                        Strengths
                      </p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                        {s.report.strengths.map((x, j) => (
                          <li key={j}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {s.report.gaps && s.report.gaps.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                        To review
                      </p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                        {s.report.gaps.map((x, j) => (
                          <li key={j}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                  Transcript
                </p>
                <div className="mt-2 space-y-1.5">
                  {s.transcript?.map((t, j) => (
                    <p key={j} className="text-sm">
                      <span
                        className={
                          t.role === "tutor"
                            ? "font-semibold text-sky-700"
                            : "font-semibold text-stone-700"
                        }
                      >
                        {t.role === "tutor" ? "Tutor" : s.studentName}:{" "}
                      </span>
                      <span className="text-stone-600">{t.text}</span>
                    </p>
                  ))}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
