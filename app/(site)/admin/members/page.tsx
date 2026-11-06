import { currentUserRecord, isOwner } from "@/lib/auth";
import { listAllUsers, type PublicUser } from "@/lib/users";
import { loadSessions } from "@/lib/sessions";
import { loadMarks } from "@/lib/marks";
import { higherMedal, medalOf, type Medal } from "@/lib/medals";
import { getAllReadings } from "@/lib/content";
import MemberRoster, {
  type Classroom,
  type RosterEntry,
} from "@/components/MemberRoster";

// Reads cookies + Blob at request time — never static.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Members · Daily Reading Club",
};

/**
 * The Members page — every login in the viewer's scope, students AND parents
 * (a parent reads and earns medals too, so they get a row like their kids;
 * their own voice-quiz attempts count in Attempts / Avg score). A regular
 * parent sees their own family; the owner sees every family in one list.
 * Only student rows are manageable (Rename / Reset password — parents own
 * their own logins).
 */
export default async function MembersPage() {
  // Same two-round-trip budget as the Reports page: one record read for
  // identity + role, then sessions and the full roster overlapped below.
  const record = await currentUserRecord();
  const user = record && record.active !== false ? record.username : null;

  if (!user || !record) {
    return (
      <div>
        <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
          Members
        </h1>
        <p className="mt-4 border-[3px] border-[#0a0a0a] bg-[#ffe600] px-4 py-3 font-sans text-sm font-bold text-[#0a0a0a]">
          Please log in (top right) to see your family&apos;s members.
        </p>
      </div>
    );
  }

  // Parent-only. A logged-in student who navigates here directly is sent back
  // to their reports.
  const owner = isOwner(user);
  if (!owner && record.role !== "parent") {
    return (
      <div>
        <h1 className="font-display text-4xl font-normal uppercase text-[#0a0a0a]">
          Members
        </h1>
        <p className="mt-4 border-[3px] border-[#0a0a0a] bg-stone-100 px-4 py-3 font-sans text-sm text-stone-600">
          This page is for parents. Your quiz results are on the{" "}
          <a href="/admin" className="font-bold underline">
            Reports
          </a>{" "}
          page.
        </p>
      </div>
    );
  }

  // The last 14 reading dates across both tracks (a junior reading usually
  // shares its date with a senior one), oldest → newest — the roster's
  // past-two-weeks medal squares.
  const recentDates = [
    ...new Set([
      ...getAllReadings("senior").map((r) => r.date),
      ...getAllReadings("junior").map((r) => r.date),
    ]),
  ]
    .sort()
    .slice(-14);

  // Per-member stats (attempts + last active) from the saved sessions, keyed by
  // username (a parent's own attempts included), so every roster shows
  // activity at a glance. Best-effort: a load
  // error just yields zero-stat rows rather than blanking the page. Loaded once
  // and shared across all classrooms (the owner may render several).
  const stats = new Map<
    string,
    {
      attempts: number;
      lastActiveIso: string | null;
      scoreSum: number;
      scoreCount: number;
      doneDates: Set<string>;
    }
  >();
  const [result, allUsers, marks] = await Promise.all([
    loadSessions(),
    listAllUsers(),
    loadMarks(),
  ]);
  if (!("error" in result)) {
    for (const s of result) {
      // A live/paused attempt (the in-progress slot) isn't a finished attempt
      // yet — it becomes one when the student Ends (or Cancels) it.
      if (s.inProgress) continue;
      const who = s.loginUser ?? s.studentName ?? "";
      if (!who) continue;
      const cur =
        stats.get(who) ?? {
          attempts: 0,
          lastActiveIso: null,
          scoreSum: 0,
          scoreCount: 0,
          doneDates: new Set<string>(),
        };
      cur.attempts += 1;
      // A completed quiz is the day's GOLD (lib/medals.ts): terminal and not
      // cancelled, either track.
      if (!s.cancelled && s.date) cur.doneDates.add(s.date);
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
      stats.set(who, cur);
    }
  }

  // The row's past-week medals: per date, the higher of the member's marks
  // on either track (the roster's dates mix tracks) or gold from a quiz.
  const recentMedalsFor = (username: string, quizzed: Set<string>) => {
    const out: Record<string, Medal> = {};
    for (const m of marks ?? []) {
      if (m.username !== username || !recentDates.includes(m.date)) continue;
      out[m.date] = higherMedal(out[m.date], medalOf(m.level, false))!;
    }
    for (const d of recentDates) if (quizzed.has(d)) out[d] = "gold";
    return out;
  };

  // Only active members are shown for now (there's no deactivate/reactivate
  // in the UI — parents can add students, and rename / reset their passwords).
  const toRoster = (members: PublicUser[]): RosterEntry[] =>
    members
      .filter((s) => s.active !== false)
      .map((s) => {
        const st = stats.get(s.username);
        return {
          username: s.username,
          displayName: s.displayName,
          role: s.role,
          active: s.active !== false,
          attempts: st?.attempts ?? 0,
          lastActiveIso: st?.lastActiveIso ?? null,
          avgScore: st && st.scoreCount > 0 ? st.scoreSum / st.scoreCount : null,
          recentMedals: recentMedalsFor(s.username, st?.doneDates ?? new Set()),
        };
      });

  // Families are carved out of the one listAllUsers read: the parent first,
  // then their students in display-name order.
  const byName = (a: PublicUser, b: PublicUser) =>
    a.displayName.localeCompare(b.displayName);
  const familyOf = (parentId: string): PublicUser[] => [
    ...allUsers.filter((u) => u.username === parentId),
    ...allUsers
      .filter((u) => u.role === "student" && u.parentId === parentId)
      .sort(byName),
  ];

  const ownRoster = toRoster(familyOf(user));

  // The owner also SEES every other family. It may ADD a student to any of
  // them (the /api/students POST lets the owner target a parentId), but
  // Rename/Reset stay own-classroom (the /api/students/[username] route still
  // ownership-checks and doesn't exempt the owner). A regular parent, and a
  // lone owner with no other parents, sees just their own family.
  const parents = owner
    ? allUsers.filter((u) => u.role === "parent").sort(byName)
    : [];
  const others = parents.filter((p) => p.username !== user);

  if (others.length === 0) {
    return (
      <div>
        <MemberRoster
          members={ownRoster}
          parentUsername={user}
          recentDates={recentDates}
        />
      </div>
    );
  }

  // Owner + other parents → ONE unified roster with a Parent column (the
  // Reports-page recipe — the per-classroom tabs were dropped as inefficient):
  // own family first (students fully editable), then each other family
  // (visible, addable-to via the modal's classroom selector, but not
  // Rename/Reset).
  const self = parents.find((p) => p.username === user);
  const otherRosters = others.map((p) => ({
    parent: p,
    members: toRoster(familyOf(p.username)),
  }));
  const unified: RosterEntry[] = [
    ...ownRoster.map((s) => ({
      ...s,
      parentName: self?.displayName ?? user,
      canManage: true,
    })),
    ...otherRosters.flatMap(({ parent, members }) =>
      members.map((s) => ({
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
      <MemberRoster
        members={unified}
        parentUsername={user}
        recentDates={recentDates}
        subtitle="Every family's parents and students in one list. You can add a student under any parent; renaming and password resets stay with each student's own parent."
        showParent
        classrooms={classrooms}
      />
    </div>
  );
}
