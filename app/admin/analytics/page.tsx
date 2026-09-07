import Link from "next/link";
import { currentUserRecord, isOwner } from "@/lib/auth";
import { listAllUsers } from "@/lib/users";
import { loadSessions } from "@/lib/sessions";
import { loadWordQuizAttempts } from "@/lib/word-quiz";
import { loadEvents, type ActivityEvent } from "@/lib/events";
import { getAllReadings } from "@/lib/content";
import {
  buildAnalytics,
  windowStart,
  type ActivityWindow,
  type Member,
} from "@/lib/analytics";
import type { Session } from "@/components/AdminSessions";
import ActivityReport from "@/components/ActivityReport";

// Reads cookies + the DB at request time — never static.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Activity · Daily Reading Club",
};

/**
 * The Activity page — who opened what, and how often (lib/analytics.ts over
 * rc_events + the quiz tables). Scoped exactly like Reports: the owner sees
 * every classroom (plus the logged-out bucket and a Parent column), a parent
 * their own classroom; students don't have it. One page for both tracks: the
 * member table is combined, the per-reading tables are one per track. The
 * window (7 days by default / 30 / all) is a query param so the aggregation
 * stays on the server.
 */

const WINDOWS: { key: string; w: ActivityWindow; label: string }[] = [
  { key: "7", w: 7, label: "7 days" },
  { key: "30", w: 30, label: "30 days" },
  { key: "all", w: "all", label: "All time" },
];

const DEFAULT_WINDOW: ActivityWindow = 7;

function parseWindow(v: string | string[] | undefined): ActivityWindow {
  const s = Array.isArray(v) ? v[0] : v;
  return WINDOWS.find((x) => x.key === s)?.w ?? DEFAULT_WINDOW;
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
      {children}
    </h1>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const record = await currentUserRecord();
  const user = record && record.active !== false ? record.username : null;

  if (!user || !record) {
    return (
      <div>
        <Title>Activity</Title>
        <p className="mt-4 border-[3px] border-[#0a0a0a] bg-[#ffe600] px-4 py-3 font-sans text-sm font-bold text-[#0a0a0a]">
          Please log in (top right) to see your classroom&apos;s activity.
        </p>
      </div>
    );
  }

  const owner = isOwner(user);
  const admin = owner || record.role === "parent";
  if (!admin) {
    return (
      <div>
        <Title>Activity</Title>
        <p className="mt-4 border-[3px] border-[#0a0a0a] bg-stone-100 px-4 py-3 font-sans text-sm text-stone-600">
          Activity is for parents. Your own quiz history is on Reports.
        </p>
      </div>
    );
  }

  const w = parseWindow((await searchParams).days);
  const since = windowStart(w);

  // Five independent reads — overlap them (each is a ~300ms round trip).
  const [seniorEvents, juniorEvents, sessionsResult, allUsers, wordAttemptsRaw] =
    await Promise.all([
      loadEvents("senior", since ?? undefined),
      loadEvents("junior", since ?? undefined),
      loadSessions(),
      listAllUsers(),
      loadWordQuizAttempts(),
    ]);

  if (seniorEvents === null || juniorEvents === null || "error" in sessionsResult) {
    return (
      <div>
        <Title>Activity</Title>
        <p className="mt-6 border-[3px] border-[#0a0a0a] bg-stone-100 px-4 py-3 font-sans text-sm text-stone-600">
          Could not load activity (database unavailable).
        </p>
      </div>
    );
  }
  const wordAttempts = wordAttemptsRaw ?? [];

  // Terminal AI-quiz attempts only — cancelled and in-progress don't count.
  const terminal = sessionsResult.filter((s) => !s.cancelled && !s.inProgress);

  // ---- scope ---------------------------------------------------------------
  // The owner sees everyone. A parent sees their classroom: their students +
  // themselves, matched by the stamped parent id or (older rows / sessions
  // that predate the stamp) by roster membership. Parents are roster members
  // too — their own opens are recorded like anyone's and get a row.
  const active = allUsers.filter((u) => u.active !== false);
  const roster = new Set<string>(
    owner
      ? active.map((u) => u.username)
      : active
          .filter((u) => u.role === "student" && u.parentId === user)
          .map((u) => u.username)
          .concat(user)
  );
  const inScopeEvent = (e: ActivityEvent) =>
    owner ? true : !!e.username && (e.parentId === user || roster.has(e.username));
  const inScopeSession = (s: Session) =>
    owner ? true : s.parentId === user || roster.has(s.loginUser ?? s.studentName ?? "");
  const inScopeAttempt = (a: { username: string; parentId?: string }) =>
    owner ? true : a.parentId === user || roster.has(a.username);

  const members: Member[] = active
    .filter((u) => roster.has(u.username))
    .map((u) => ({
      username: u.username,
      role: u.role === "parent" ? "parent" : "student",
      parentId: u.role === "parent" ? null : u.parentId ?? null,
    }));

  // Owner's Parent column: parent username → display name.
  const parentNames: Record<string, string> = {};
  for (const u of active) if (u.role === "parent") parentNames[u.username] = u.displayName;

  const data = buildAnalytics({
    readings: { senior: getAllReadings("senior"), junior: getAllReadings("junior") },
    events: seniorEvents.concat(juniorEvents).filter(inScopeEvent),
    sessions: terminal.filter(inScopeSession),
    wordAttempts: wordAttempts.filter(inScopeAttempt),
    members,
    since,
  });

  const windowKey = WINDOWS.find((x) => x.w === w)!.key;

  return (
    <div>
      <Title>Activity</Title>
      <p className="mt-2 font-sans text-[13px] text-stone-500">
        Who opened the article, the handout and the self-quiz, how many times,
        and how long the article stayed on screen — next to the AI-quiz and
        word-quiz completions. Page opens have been recorded since Sep 7, 2026;
        quiz counts go back further.
      </p>

      {/* Window toggle — plain links, so the server re-aggregates. Styled as
          the tab buttons (selected = inverted). */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="mr-1 font-mono text-[11px] font-bold uppercase tracking-[.12em] text-stone-500">
          Window
        </span>
        {WINDOWS.map((x) => {
          const selected = x.key === windowKey;
          return (
            <Link
              key={x.key}
              href={x.w === DEFAULT_WINDOW ? "/admin/analytics" : `/admin/analytics?days=${x.key}`}
              aria-current={selected ? "page" : undefined}
              className={`border-2 border-[#0a0a0a] px-4 py-2 font-mono text-xs font-bold uppercase tracking-[.06em] no-underline transition ${
                selected
                  ? "bg-[#0a0a0a] text-[#ffe600]"
                  : "bg-white text-[#0a0a0a] hover:bg-[#ffe600]"
              }`}
            >
              {x.label}
            </Link>
          );
        })}
      </div>

      <ActivityReport
        data={data}
        showAnon={owner}
        parentNames={owner ? parentNames : undefined}
      />
    </div>
  );
}
