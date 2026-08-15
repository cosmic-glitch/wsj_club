import { currentUserRecord, isOwner } from "@/lib/auth";
import { listAllUsers, type PublicUser } from "@/lib/users";
import { loadSessions } from "@/lib/sessions";
import { loadWordQuizAttempts, type WordQuizAttempt } from "@/lib/word-quiz";
import { dateBig } from "@/lib/content";
import AdminSessions, {
  type Session,
  type ArticleGroup,
} from "@/components/AdminSessions";
import ClassroomTabs from "@/components/ClassroomTabs";

// Reads cookies + Blob at request time — never static.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reports · Daily Reading Club",
};

/**
 * Group every saved session by its article (one table row per day), newest
 * article first, with attempts ordered chronologically within each article so
 * the "sequenced list" numbers them 1, 2, 3 in the order they were taken. The
 * date label is computed here (with the shared dateBig) because lib/content
 * can't be imported into the client component.
 */
function groupByArticle(sessions: Session[]): ArticleGroup[] {
  // Key on track+date, NOT date alone: a junior and a senior attempt land on the
  // same date by default (junior is occasional, senior daily), and keying on
  // date alone would merge them into one row under whichever title landed first
  // — silently mis-filing a junior attempt under the senior article. The title
  // is already stamped on each session (s.title), so this needs no getReading.
  const byKey = new Map<string, ArticleGroup>();
  for (const s of sessions) {
    const key = `${s.track ?? "senior"}:${s.date}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        date: s.date,
        track: s.track,
        dateLabel: dateBig(s.date),
        title: s.title,
        attempts: [],
      };
      byKey.set(key, g);
    }
    g.attempts.push(s);
  }
  const groups = Array.from(byKey.values());
  groups.sort((a, b) => b.date.localeCompare(a.date));
  // An in-progress slot has no endedAt (nothing ended) — order it by its last
  // checkpoint time instead.
  const when = (s: Session) => s.endedAt ?? s.updatedAt ?? "";
  for (const g of groups) {
    g.attempts.sort((a, b) => when(a).localeCompare(when(b)));
  }
  return groups;
}

/**
 * Scope a session list to one parent's classroom: sessions stamped with that
 * parentId, or (fallback for older sessions saved before the stamp existed)
 * whose owning student/parent is in the roster. The roster includes the parent
 * so their own attempts show too.
 */
function scopeToClassroom(
  sessions: Session[],
  parent: string,
  roster: Set<string>
): Session[] {
  return sessions.filter((s) => {
    const owner = s.loginUser ?? s.studentName ?? "";
    return s.parentId === parent || roster.has(owner);
  });
}

/** A classroom's by-article table, or a friendly empty state when it has none. */
function classroomPanel(
  groups: ArticleGroup[],
  canDelete: boolean,
  viewerUser: string,
  showParent = false
) {
  if (groups.length === 0) {
    return (
      <p className="mt-6 border-[3px] border-dashed border-[#0a0a0a] bg-white p-8 text-center font-mono text-sm font-bold uppercase tracking-[.08em] text-stone-500">
        No quiz sessions yet.
      </p>
    );
  }
  // Every classroom panel is a parent/owner viewing classroom data, so the
  // parent-only notes show; only the owner's own classroom is deletable. The
  // owner's unified view (showParent) adds a column naming each attempt's
  // parent, since it collapses every classroom into one table.
  return (
    <AdminSessions
      groups={groups}
      canDelete={canDelete}
      parentView
      viewerUser={viewerUser}
      showParent={showParent}
    />
  );
}

/**
 * The compact word-bank-quiz history — one row per recorded round, newest
 * first. No Details modal: the whole story fits the row (score + the words
 * missed). Rendered only when the viewer's scope has at least one round.
 */
function WordQuizPanel({
  attempts,
  showStudent,
  parentNameFor,
}: {
  attempts: WordQuizAttempt[];
  showStudent: boolean;
  parentNameFor?: (a: WordQuizAttempt) => string;
}) {
  if (attempts.length === 0) return null;
  const when = (iso: string) =>
    `${dateBig(iso.slice(0, 10))}, ${new Date(iso).toLocaleTimeString("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
    })}`;
  const th =
    "border-b-[3px] border-[#0a0a0a] px-3 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-[.1em] text-[#0a0a0a]";
  const td = "border-b border-stone-300 px-3 py-2 align-top text-sm";
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl font-normal uppercase text-[#0a0a0a]">
        Word quizzes
      </h2>
      <p className="mt-1 font-sans text-[13px] text-stone-500">
        Self-quiz rounds on the word bank — missed words come back sooner until
        they&apos;re mastered.
      </p>
      <div className="mt-3 overflow-x-auto border-[3px] border-[#0a0a0a] bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>When</th>
              {showStudent && <th className={th}>Student</th>}
              {parentNameFor && <th className={th}>Parent</th>}
              <th className={th}>Track</th>
              <th className={th}>Score</th>
              <th className={th}>Missed words</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.id} className="last:[&>td]:border-b-0">
                <td className={`${td} whitespace-nowrap text-stone-600`}>
                  {when(a.createdAt)}
                </td>
                {showStudent && (
                  <td className={`${td} font-bold text-[#0a0a0a]`}>
                    {a.username}
                  </td>
                )}
                {parentNameFor && (
                  <td className={`${td} text-stone-600`}>{parentNameFor(a)}</td>
                )}
                <td className={td}>
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[.08em] text-stone-500">
                    {a.track === "junior" ? "Junior" : "Regular"}
                  </span>
                </td>
                <td className={`${td} whitespace-nowrap font-bold text-[#0a0a0a]`}>
                  {a.score} / {a.total}
                </td>
                <td className={`${td} text-stone-600`}>
                  {a.missed.length === 0 ? (
                    <span className="font-mono text-[11px] font-bold uppercase tracking-[.08em] text-emerald-700">
                      None
                    </span>
                  ) : (
                    a.missed.join(", ")
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function AdminPage() {
  // One record read serves both identity and role — currentUser() followed by
  // isAdmin() would fetch the same rc_users row twice. Every DB round trip
  // here is ~300ms+, so the page's whole budget is the number of sequential
  // awaits; keep it at two (this read, then the Promise.all below).
  const record = await currentUserRecord();
  const user = record && record.active !== false ? record.username : null;

  // Any logged-in user can see their reports; logged-out visitors can't.
  if (!user || !record) {
    return (
      <div>
        <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
          Your reports
        </h1>
        <p className="mt-4 border-[3px] border-[#0a0a0a] bg-[#ffe600] px-4 py-3 font-sans text-sm font-bold text-[#0a0a0a]">
          Please log in (top right) to see your quiz reports and recordings.
        </p>
      </div>
    );
  }

  // Delete is OWNER-only: a regular parent can view (and open Details on) their
  // classroom's attempts but never delete one — only the owner gets a Delete
  // column, and only in their own classroom (other parents' tabs stay read-only,
  // and the delete route ownership-checks regardless).
  const owner = isOwner(user);
  const admin = owner || record.role === "parent";

  // Sessions and the roster are independent reads — overlap them. Students
  // never need the roster, so theirs stays a single read.
  const [result, allUsers, wordAttemptsRaw] = await Promise.all([
    loadSessions(),
    admin ? listAllUsers() : Promise.resolve<PublicUser[]>([]),
    loadWordQuizAttempts(),
  ]);
  // A failed attempts read never blocks the page — the section just hides.
  const wordAttempts = wordAttemptsRaw ?? [];

  if ("error" in result) {
    return (
      <div>
        <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
          {admin ? "Quiz reports" : "Your reports"}
        </h1>
        <p className="mt-6 border-[3px] border-[#0a0a0a] bg-stone-100 px-4 py-3 font-sans text-sm text-stone-600">
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
        <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
          Your reports
        </h1>
        <p className="mt-2 font-sans text-[13px] text-stone-500">
          Your saved voice-quiz attempts — click Details on any attempt for its
          full report card, recording, and transcript.
        </p>
        {visible.length === 0 ? (
          <p className="mt-6 border-[3px] border-dashed border-[#0a0a0a] bg-white p-8 text-center font-mono text-sm font-bold uppercase tracking-[.08em] text-stone-500">
            You haven&apos;t taken any voice quizzes yet.
          </p>
        ) : (
          <AdminSessions
            groups={groupByArticle(visible)}
            canDelete={false}
            viewerUser={user}
          />
        )}
        <WordQuizPanel
          attempts={wordAttempts.filter((a) => a.username === user)}
          showStudent={false}
        />
      </div>
    );
  }

  // A REGULAR parent sees only their own classroom — one table, no Parent
  // column, no Delete (Delete is owner-only). Roster = their students +
  // themselves; older sessions predate the parent stamp, so scopeToClassroom
  // falls back to roster membership by loginUser.
  if (!owner) {
    const roster = new Set(
      allUsers
        .filter((u) => u.role === "student" && u.parentId === user)
        .map((u) => u.username)
    );
    roster.add(user);
    const groups = groupByArticle(scopeToClassroom(result, user, roster));
    return (
      <div>
        <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
          Quiz reports
        </h1>
        <p className="mt-2 font-sans text-[13px] text-stone-500">
          Saved voice-quiz attempts by article — click Details on any attempt
          for its full report card, recording, and transcript.
        </p>
        {classroomPanel(groups, false, user)}
        <WordQuizPanel
          attempts={wordAttempts.filter(
            (a) => a.parentId === user || roster.has(a.username),
          )}
          showStudent
        />
      </div>
    );
  }

  // The OWNER sees EVERY classroom collapsed into ONE table (no more per-parent
  // tabs to click through), by article, newest first, with a Parent column
  // naming whose classroom each attempt belongs to. The junior and senior tracks
  // are split into two tabs (Regular is the default) so a junior 8/10 is never
  // shown alongside a senior 8/10; within each tab it's still all classrooms
  // combined. The owner may delete in any classroom, so both tables are deletable.
  //
  // Resolve each session's parent: prefer the stamped parentId; fall back to
  // roster membership by the owning student (older sessions predate the stamp).
  // A parent's own attempts map to themselves.
  const parentDisplay = new Map<string, string>();
  const studentToParent = new Map<string, string>();
  for (const u of allUsers) {
    if (u.role === "parent") {
      parentDisplay.set(u.username, u.displayName);
      studentToParent.set(u.username, u.username);
    } else if (u.parentId) {
      studentToParent.set(u.username, u.parentId);
    }
  }
  const parentNameFor = (s: Session): string => {
    const student = s.loginUser ?? s.studentName ?? "";
    const uname = s.parentId || studentToParent.get(student) || "";
    return parentDisplay.get(uname) || uname || "—";
  };
  const enriched = result.map((s) => ({ ...s, parentName: parentNameFor(s) }));

  const seniorGroups = groupByArticle(enriched.filter((s) => s.track !== "junior"));
  const juniorGroups = groupByArticle(enriched.filter((s) => s.track === "junior"));

  return (
    <div>
      <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
        Quiz reports
      </h1>
      <p className="mt-2 font-sans text-[13px] text-stone-500">
        Every classroom&apos;s attempts, by article — the Parent column shows
        whose classroom each is. Click Details for the full report card,
        recording, and transcript.
      </p>
      <div className="mt-6">
        <ClassroomTabs
          ariaLabel="Reading track"
          tabs={[
            {
              key: "senior",
              label: "Regular",
              content: classroomPanel(seniorGroups, true, user, true),
            },
            {
              key: "junior",
              label: "Junior",
              content: classroomPanel(juniorGroups, true, user, true),
            },
          ]}
        />
      </div>
      <WordQuizPanel
        attempts={wordAttempts}
        showStudent
        parentNameFor={(a) => {
          const uname = a.parentId || studentToParent.get(a.username) || "";
          return parentDisplay.get(uname) || uname || "—";
        }}
      />
    </div>
  );
}
