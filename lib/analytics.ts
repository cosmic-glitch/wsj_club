import type { Reading, Track } from "@/lib/content";
import type { ActivityEvent } from "@/lib/events";
import type { Session } from "@/components/AdminSessions";
import type { WordQuizAttempt } from "@/lib/word-quiz";

/**
 * The Activity page's aggregation (app/admin/analytics) — pure functions over
 * the rows the page has already loaded and SCOPED (the page decides whose
 * events/sessions a viewer may see; this module only counts). One build
 * covers BOTH tracks and yields two views:
 *
 *   students — one row per person with any activity in the window (students,
 *              then parents; the idle roster is only counted), combined
 *              across tracks: distinct readings touched per step, read time,
 *              taps, last active — plus a per-reading timeline (both tracks,
 *              newest first) for the expanded row.
 *   tracks   — per track, one row per reading dated in the window, with the
 *              funnel (article → handout → self-quiz → AI quiz) as people +
 *              opens, the median read time, glossary taps, and the per-person
 *              detail.
 *
 * `date` is NOT unique across tracks, so every per-reading key carries the
 * track. "Read time" = the article page's visible seconds: article_read
 * events carry a cumulative figure per page load (`meta.v`), so a load
 * contributes its MAX, clamped (a tab left open is not reading), summed per
 * person per reading.
 *
 * Anonymous (username null) events are counted in their own bucket, never
 * attributed — the owner's rule. Days are club-local (US Pacific).
 */

export type ActivityWindow = 7 | 30 | "all";

export const TRACKS: Track[] = ["senior", "junior"];

/** Clamp on one page load's visible time — beyond this it's a forgotten tab. */
const MAX_VIEW_SECONDS = 30 * 60;

/** The club-local calendar day ('YYYY-MM-DD') of an ISO instant. */
function clubDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

/** The ISO instant `days` days before now, or null for an unbounded window. */
export function windowStart(w: ActivityWindow): string | null {
  if (w === "all") return null;
  return new Date(Date.now() - w * 86_400_000).toISOString();
}

export type PersonActivity = {
  username: string;
  articleOpens: number;
  articleFirst: string | null; // ISO of the first open
  readSeconds: number;
  handoutOpens: number;
  selfquizOpens: number;
  glossTaps: number;
  quizDone: boolean; // a terminal AI-quiz attempt on this reading
  quizWhen: string | null;
};

export type ReadingActivity = {
  date: string;
  title: string;
  articlePeople: number;
  articleOpens: number;
  readMedianSeconds: number | null; // across people who read at all
  handoutPeople: number;
  handoutOpens: number;
  selfquizPeople: number;
  selfquizOpens: number;
  quizPeople: number;
  glossTaps: number;
  anon: { articleOpens: number; handoutOpens: number; selfquizOpens: number; glossTaps: number };
  topWords: { word: string; taps: number }[]; // most-tapped glossary terms (everyone, anon included)
  people: PersonActivity[]; // by first article open, then name
};

export type StudentDay = {
  track: Track;
  date: string;
  title: string;
  articleOpens: number;
  readSeconds: number;
  handoutOpens: number;
  selfquizOpens: number;
  quizDone: boolean;
  glossTaps: number;
};

export type StudentRow = {
  username: string;
  role: "student" | "parent";
  parentId: string | null;
  articles: number; // distinct readings whose article page they opened (in window)
  handouts: number;
  selfquizzes: number;
  quizzes: number; // distinct readings with a terminal AI quiz
  wordRounds: number; // word-bank quiz rounds finished
  wordbankOpens: number;
  readSeconds: number;
  glossTaps: number;
  lastActive: string | null; // ISO
  days: StudentDay[]; // readings touched, newest first
};

export type TrackReadings = {
  track: Track;
  readingsInWindow: number;
  readings: ReadingActivity[];
};

export type Analytics = {
  students: StudentRow[];
  idleMembers: number; // roster members with no row (nothing in the window)
  tracks: TrackReadings[]; // senior, then junior
  anon: {
    articleOpens: number;
    handoutOpens: number;
    selfquizOpens: number;
    wordbankOpens: number;
    glossTaps: number;
  };
};

export type Member = {
  username: string;
  role: "student" | "parent";
  parentId: string | null;
};

type Tally = {
  articleOpens: number;
  articleFirst: string | null;
  handoutOpens: number;
  selfquizOpens: number;
  glossTaps: number;
  /** view id → max cumulative seconds seen for that page load */
  views: Map<string, number>;
};

const freshTally = (): Tally => ({
  articleOpens: 0,
  articleFirst: null,
  handoutOpens: 0,
  selfquizOpens: 0,
  glossTaps: 0,
  views: new Map(),
});

function readSeconds(t: Tally): number {
  let s = 0;
  for (const v of t.views.values()) s += Math.min(v, MAX_VIEW_SECONDS);
  return s;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Apply one event to a tally. */
function absorb(t: Tally, e: ActivityEvent) {
  switch (e.kind) {
    case "article_view":
      t.articleOpens++;
      if (!t.articleFirst || e.at < t.articleFirst) t.articleFirst = e.at;
      break;
    case "article_read": {
      // No view id (shouldn't happen) → the event is its own view.
      const key = e.meta.v ?? `e${e.id}`;
      const s = e.meta.seconds ?? 0;
      if (s > (t.views.get(key) ?? 0)) t.views.set(key, s);
      break;
    }
    case "handout_view":
      t.handoutOpens++;
      break;
    case "selfquiz_view":
      t.selfquizOpens++;
      break;
    case "gloss_tap":
      t.glossTaps++;
      break;
    default:
      break;
  }
}

function sessionAccount(s: Session): string | null {
  return s.loginUser ?? s.studentName ?? null;
}

function sessionTrack(s: Session): Track {
  return s.track === "junior" ? "junior" : "senior";
}

/** A reading's identity across tracks (dates repeat between tracks). */
const readingKey = (track: Track, date: string) => `${track}\0${date}`;
/** A (reading, person) tally key; the anonymous bucket is user "". */
const personKey = (rk: string, user: string) => `${rk}\0${user}`;

export function buildAnalytics(input: {
  /** Each track's readings, newest first (the content index order). */
  readings: Record<Track, Reading[]>;
  /** Events on both tracks, already scoped to what the viewer may see. */
  events: ActivityEvent[];
  /** TERMINAL AI-quiz sessions, both tracks (no cancelled / in-progress), scoped. */
  sessions: Session[];
  /** Word-bank rounds, both tracks, scoped. */
  wordAttempts: WordQuizAttempt[];
  /** The roster — sets role/parent on a row; the idle ones are only counted. */
  members: Member[];
  /** Window start (ISO) or null for all time. */
  since: string | null;
}): Analytics {
  const { members, since } = input;
  const sinceDay = since ? clubDay(since) : null;
  const inWindow = (iso: string) => !since || iso >= since;

  const events = input.events.filter((e) => inWindow(e.at));
  const sessions = input.sessions.filter((s) => !!s.endedAt && inWindow(s.endedAt));
  const wordAttempts = input.wordAttempts.filter((a) => inWindow(a.createdAt));

  const titleOf = new Map<string, string>();
  const readingsInWindow: Record<Track, Reading[]> = { senior: [], junior: [] };
  for (const track of TRACKS) {
    for (const r of input.readings[track]) titleOf.set(readingKey(track, r.date), r.title);
    readingsInWindow[track] = input.readings[track].filter(
      (r) => !sinceDay || r.date >= sinceDay
    );
  }

  // ---- per (reading, person) tallies ---------------------------------------
  const tallies = new Map<string, Tally>();
  const tallyFor = (rk: string, user: string) => {
    const k = personKey(rk, user);
    let t = tallies.get(k);
    if (!t) tallies.set(k, (t = freshTally()));
    return t;
  };
  const wordTaps = new Map<string, Map<string, number>>(); // reading → word → taps
  const anon = { articleOpens: 0, handoutOpens: 0, selfquizOpens: 0, wordbankOpens: 0, glossTaps: 0 };
  const wordbankOpens = new Map<string, number>(); // user → opens
  const lastActive = new Map<string, string>(); // user → ISO
  const touch = (user: string, at: string) => {
    if (!lastActive.has(user) || at > lastActive.get(user)!) lastActive.set(user, at);
  };
  // user → the readings (keys) they touched, either by an event or a quiz.
  const touched = new Map<string, Set<string>>();
  const touchReading = (user: string, rk: string) =>
    (touched.get(user) ?? touched.set(user, new Set()).get(user)!).add(rk);

  for (const e of events) {
    if (e.username) touch(e.username, e.at);
    if (e.kind === "wordbank_view") {
      if (e.username) wordbankOpens.set(e.username, (wordbankOpens.get(e.username) ?? 0) + 1);
      else anon.wordbankOpens++;
      continue;
    }
    if (!e.date) continue;
    const rk = readingKey(e.track, e.date);
    absorb(tallyFor(rk, e.username ?? ""), e);
    if (e.username) touchReading(e.username, rk);
    else {
      if (e.kind === "article_view") anon.articleOpens++;
      else if (e.kind === "handout_view") anon.handoutOpens++;
      else if (e.kind === "selfquiz_view") anon.selfquizOpens++;
      else if (e.kind === "gloss_tap") anon.glossTaps++;
    }
    if (e.kind === "gloss_tap" && e.meta.word) {
      const m = wordTaps.get(rk) ?? wordTaps.set(rk, new Map()).get(rk)!;
      m.set(e.meta.word, (m.get(e.meta.word) ?? 0) + 1);
    }
  }

  // ---- AI-quiz completions: (reading, user) → earliest end ----------------
  const quizDone = new Map<string, string>();
  for (const s of sessions) {
    const user = sessionAccount(s);
    if (!user || !s.date) continue;
    const rk = readingKey(sessionTrack(s), s.date);
    const k = personKey(rk, user);
    if (!quizDone.has(k) || s.endedAt! < quizDone.get(k)!) quizDone.set(k, s.endedAt!);
    touch(user, s.endedAt!);
    touchReading(user, rk);
  }
  const wordRounds = new Map<string, number>();
  for (const a of wordAttempts) {
    wordRounds.set(a.username, (wordRounds.get(a.username) ?? 0) + 1);
    if (a.createdAt) touch(a.username, a.createdAt);
  }

  // Every named person with any activity, plus the roster.
  const people = new Set<string>(members.map((m) => m.username));
  for (const u of touched.keys()) people.add(u);
  for (const u of wordRounds.keys()) people.add(u);
  for (const u of wordbankOpens.keys()) people.add(u);

  // ---- by reading, per track -------------------------------------------------
  const tracks: TrackReadings[] = TRACKS.map((track) => ({
    track,
    readingsInWindow: readingsInWindow[track].length,
    readings: readingsInWindow[track].map((r) => {
      const rk = readingKey(track, r.date);
      const persons: PersonActivity[] = [];
      let articleOpens = 0,
        handoutOpens = 0,
        selfquizOpens = 0,
        glossTaps = 0;
      let articlePeople = 0,
        handoutPeople = 0,
        selfquizPeople = 0,
        quizPeople = 0;
      const reads: number[] = [];
      for (const u of people) {
        const t = tallies.get(personKey(rk, u));
        const qw = quizDone.get(personKey(rk, u)) ?? null;
        if (!t && !qw) continue;
        const rs = t ? readSeconds(t) : 0;
        const p: PersonActivity = {
          username: u,
          articleOpens: t?.articleOpens ?? 0,
          articleFirst: t?.articleFirst ?? null,
          readSeconds: rs,
          handoutOpens: t?.handoutOpens ?? 0,
          selfquizOpens: t?.selfquizOpens ?? 0,
          glossTaps: t?.glossTaps ?? 0,
          quizDone: qw !== null,
          quizWhen: qw,
        };
        persons.push(p);
        articleOpens += p.articleOpens;
        handoutOpens += p.handoutOpens;
        selfquizOpens += p.selfquizOpens;
        glossTaps += p.glossTaps;
        if (p.articleOpens) articlePeople++;
        if (p.handoutOpens) handoutPeople++;
        if (p.selfquizOpens) selfquizPeople++;
        if (p.quizDone) quizPeople++;
        if (rs > 0) reads.push(rs);
      }
      persons.sort((a, b) => {
        const fa = a.articleFirst ?? a.quizWhen ?? "~";
        const fb = b.articleFirst ?? b.quizWhen ?? "~";
        return fa < fb ? -1 : fa > fb ? 1 : a.username.localeCompare(b.username);
      });
      const at = tallies.get(personKey(rk, ""));
      const topWords = [...(wordTaps.get(rk) ?? new Map<string, number>())]
        .map(([word, taps]) => ({ word, taps }))
        .sort((a, b) => b.taps - a.taps || a.word.localeCompare(b.word))
        .slice(0, 5);
      return {
        date: r.date,
        title: r.title,
        articlePeople,
        articleOpens,
        readMedianSeconds: median(reads),
        handoutPeople,
        handoutOpens,
        selfquizPeople,
        selfquizOpens,
        quizPeople,
        glossTaps,
        anon: {
          articleOpens: at?.articleOpens ?? 0,
          handoutOpens: at?.handoutOpens ?? 0,
          selfquizOpens: at?.selfquizOpens ?? 0,
          glossTaps: at?.glossTaps ?? 0,
        },
        topWords,
        people: persons,
      };
    }),
  }));

  // ---- by student, both tracks ----------------------------------------------
  const memberOf = new Map(members.map((m) => [m.username, m]));
  const trackOrder = (t: Track) => TRACKS.indexOf(t);
  const studentRows: StudentRow[] = [];
  let idleMembers = 0;
  for (const u of people) {
    const m = memberOf.get(u);
    const days: StudentDay[] = [];
    let readSecs = 0,
      taps = 0;
    for (const rk of touched.get(u) ?? []) {
      const [track, date] = rk.split("\0") as [Track, string];
      const t = tallies.get(personKey(rk, u));
      const rs = t ? readSeconds(t) : 0;
      readSecs += rs;
      taps += t?.glossTaps ?? 0;
      days.push({
        track,
        date,
        title: titleOf.get(rk) ?? "",
        articleOpens: t?.articleOpens ?? 0,
        readSeconds: rs,
        handoutOpens: t?.handoutOpens ?? 0,
        selfquizOpens: t?.selfquizOpens ?? 0,
        quizDone: quizDone.has(personKey(rk, u)),
        glossTaps: t?.glossTaps ?? 0,
      });
    }
    // Newest first; the same date on both tracks lists senior first.
    days.sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? 1 : -1) : trackOrder(a.track) - trackOrder(b.track)
    );
    const hasActivity =
      days.length > 0 || (wordRounds.get(u) ?? 0) > 0 || (wordbankOpens.get(u) ?? 0) > 0;
    // Only people who did something get a row — a roster of zero rows hid
    // the few real ones. The idle members surface as one count.
    if (!hasActivity) {
      if (m) idleMembers++;
      continue;
    }
    studentRows.push({
      username: u,
      role: m?.role ?? "parent",
      parentId: m?.parentId ?? null,
      articles: days.filter((d) => d.articleOpens > 0).length,
      handouts: days.filter((d) => d.handoutOpens > 0).length,
      selfquizzes: days.filter((d) => d.selfquizOpens > 0).length,
      quizzes: days.filter((d) => d.quizDone).length,
      wordRounds: wordRounds.get(u) ?? 0,
      wordbankOpens: wordbankOpens.get(u) ?? 0,
      readSeconds: readSecs,
      glossTaps: taps,
      lastActive: lastActive.get(u) ?? null,
      days,
    });
  }
  // Students first, most recently active first, the never-active at the bottom.
  studentRows.sort((a, b) => {
    if (a.role !== b.role) return a.role === "student" ? -1 : 1;
    if (a.lastActive !== b.lastActive) {
      if (!a.lastActive) return 1;
      if (!b.lastActive) return -1;
      return a.lastActive < b.lastActive ? 1 : -1;
    }
    return a.username.localeCompare(b.username);
  });

  return { students: studentRows, idleMembers, tracks, anon };
}
