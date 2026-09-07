"use client";

import { useState } from "react";
import type {
  Analytics,
  PersonActivity,
  ReadingActivity,
  StudentDay,
  StudentRow,
  TrackReadings,
} from "@/lib/analytics";

/**
 * The Activity page's body (app/admin/analytics): the by-student table,
 * combined across both tracks, then one by-reading funnel table per track
 * (Regular, then Junior) — each row expands in place to its detail (that
 * student's per-reading timeline / who did which step and when). All numbers
 * arrive
 * pre-aggregated from lib/analytics.ts; this component only lays them out.
 * Client only for the expand/collapse state — nothing is fetched here.
 *
 * `showAnon` (owner only) adds the logged-out bucket; `parentNames` (owner
 * only) adds the Parent column to the student table, since the owner's view
 * collapses every classroom into one list.
 */

const th =
  "border-b-[3px] border-[#0a0a0a] px-3 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-[.1em] text-[#0a0a0a] whitespace-nowrap";
const td = "border-b border-stone-300 px-3 py-2 align-top text-sm";
const muted = "text-stone-400";
const chip =
  "font-mono text-[11px] font-bold uppercase tracking-[.08em] text-stone-500";

/** "2026-07-08" → "Jul 8" (the index rows' date tag). */
function dateTag(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Club-local "Sep 7, 9:14 AM". Explicit zone so server and client agree. */
function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Seconds → "45s" / "12m" / "1h 05m"; zero → a muted dash. */
function dur(seconds: number | null): React.ReactNode {
  if (!seconds) return <span className={muted}>—</span>;
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "3 /7" — people who took the step, then total opens, muted. */
function Step({ people, opens }: { people: number; opens: number }) {
  if (!opens) return <span className={muted}>—</span>;
  return (
    <span className="whitespace-nowrap">
      <b className="text-[#0a0a0a]">{people}</b>
      <span className={muted}> /{opens}</span>
    </span>
  );
}

/** "5 /12" — of the readings in the window. */
function OfN({ n, total }: { n: number; total: number }) {
  if (!n) return <span className={muted}>—</span>;
  return (
    <span className="whitespace-nowrap">
      <b className="text-[#0a0a0a]">{n}</b>
      <span className={muted}> /{total}</span>
    </span>
  );
}

function Count({ n }: { n: number }) {
  return n ? <span className="text-[#0a0a0a]">{n}</span> : <span className={muted}>—</span>;
}

function Check({ on }: { on: boolean }) {
  return on ? (
    <span className="font-mono text-[11px] font-bold uppercase tracking-[.08em] text-emerald-700">
      Done
    </span>
  ) : (
    <span className={muted}>—</span>
  );
}

function Toggle({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block w-4 font-mono text-[13px] font-bold text-[#0a0a0a]"
    >
      {open ? "−" : "+"}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 border-[3px] border-dashed border-[#0a0a0a] bg-white p-8 text-center font-mono text-sm font-bold uppercase tracking-[.08em] text-stone-500">
      {children}
    </p>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl font-normal uppercase text-[#0a0a0a]">
        {title}
      </h2>
      <p className="mt-1 font-sans text-[13px] text-stone-500">{note}</p>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------- by reading */

function PeopleTable({ r }: { r: ReadingActivity }) {
  return (
    <div className="border-l-[3px] border-[#ffe600] pl-3">
      {r.people.length === 0 ? (
        <p className={`${chip} py-2`}>No member activity on this reading.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Who</th>
              <th className={th}>Article</th>
              <th className={th}>Read</th>
              <th className={th}>First open</th>
              <th className={th}>Handout</th>
              <th className={th}>Self-quiz</th>
              <th className={th}>AI quiz</th>
              <th className={th}>Taps</th>
            </tr>
          </thead>
          <tbody>
            {r.people.map((p: PersonActivity) => (
              <tr key={p.username} className="last:[&>td]:border-b-0">
                <td className={`${td} font-bold text-[#0a0a0a]`}>{p.username}</td>
                <td className={td}>
                  <Count n={p.articleOpens} />
                </td>
                <td className={td}>{dur(p.readSeconds)}</td>
                <td className={`${td} whitespace-nowrap text-stone-600`}>
                  {when(p.articleFirst)}
                </td>
                <td className={td}>
                  <Count n={p.handoutOpens} />
                </td>
                <td className={td}>
                  <Count n={p.selfquizOpens} />
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  <Check on={p.quizDone} />
                  {p.quizWhen && (
                    <span className={`${muted} ml-2 text-xs`}>{when(p.quizWhen)}</span>
                  )}
                </td>
                <td className={td}>
                  <Count n={p.glossTaps} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.topWords.length > 0 && (
        <p className="py-2 font-sans text-[13px] text-stone-600">
          <span className={chip}>Most tapped: </span>
          {r.topWords.map((w, i) => (
            <span key={w.word}>
              {i > 0 && ", "}
              <b className="text-[#0a0a0a]">{w.word}</b>
              <span className={muted}> ×{w.taps}</span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

const TRACK_LABEL = { senior: "Regular", junior: "Junior" } as const;

function ReadingsTable({
  tr,
  showAnon,
}: {
  tr: TrackReadings;
  showAnon: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const cols = showAnon ? 10 : 9;

  return (
    <Section
      title={`${TRACK_LABEL[tr.track]} readings`}
      note="The funnel per reading: article → handout → self-quiz → AI quiz. Each step shows people who took it / total opens. Read = median time the article page was visible. Click a row for who did what."
    >
      {tr.readings.length === 0 ? (
        <Empty>No readings in this window.</Empty>
      ) : (
        <div className="mt-3 overflow-x-auto border-[3px] border-[#0a0a0a] bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}></th>
                <th className={th}>Date</th>
                <th className={`${th} w-full`}>Reading</th>
                <th className={th}>Article</th>
                <th className={th}>Read</th>
                <th className={th}>Handout</th>
                <th className={th}>Self-quiz</th>
                <th className={th}>AI quiz</th>
                <th className={th}>Taps</th>
                {showAnon && <th className={th}>Logged out</th>}
              </tr>
            </thead>
            <tbody>
              {tr.readings.map((r) => {
                const isOpen = open.has(r.date);
                return (
                  <ReadingRows
                    key={r.date}
                    r={r}
                    isOpen={isOpen}
                    onToggle={() => toggle(r.date)}
                    showAnon={showAnon}
                    cols={cols}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function ReadingRows({
  r,
  isOpen,
  onToggle,
  showAnon,
  cols,
}: {
  r: ReadingActivity;
  isOpen: boolean;
  onToggle: () => void;
  showAnon: boolean;
  cols: number;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer hover:bg-[#ffe600] ${isOpen ? "bg-stone-100" : ""}`}
      >
        <td className={`${td} pr-0`}>
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={isOpen ? "Collapse" : "Expand"}
            className="cursor-pointer"
          >
            <Toggle open={isOpen} />
          </button>
        </td>
        <td className={`${td} whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[.06em]`}>
          {dateTag(r.date)}
        </td>
        <td className={`${td} font-sans font-bold text-[#0a0a0a]`}>{r.title}</td>
        <td className={td}>
          <Step people={r.articlePeople} opens={r.articleOpens} />
        </td>
        <td className={`${td} whitespace-nowrap`}>{dur(r.readMedianSeconds)}</td>
        <td className={td}>
          <Step people={r.handoutPeople} opens={r.handoutOpens} />
        </td>
        <td className={td}>
          <Step people={r.selfquizPeople} opens={r.selfquizOpens} />
        </td>
        <td className={td}>
          <Count n={r.quizPeople} />
        </td>
        <td className={td}>
          <Count n={r.glossTaps} />
        </td>
        {showAnon && (
          <td className={`${td} whitespace-nowrap ${muted}`}>
            {r.anon.articleOpens + r.anon.handoutOpens + r.anon.selfquizOpens + r.anon.glossTaps
              ? `${r.anon.articleOpens} · ${r.anon.handoutOpens} · ${r.anon.selfquizOpens} · ${r.anon.glossTaps}`
              : "—"}
          </td>
        )}
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={cols} className="border-b border-stone-300 bg-stone-50 px-3 py-3">
            <PeopleTable r={r} />
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------- by student */

function DaysTable({ days }: { days: StudentDay[] }) {
  if (days.length === 0) {
    return (
      <p className={`${chip} border-l-[3px] border-[#ffe600] py-2 pl-3`}>
        No reading opened in this window.
      </p>
    );
  }
  return (
    <div className="border-l-[3px] border-[#ffe600] pl-3">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>Date</th>
            <th className={`${th} w-full`}>Reading</th>
            <th className={th}>Article</th>
            <th className={th}>Read</th>
            <th className={th}>Handout</th>
            <th className={th}>Self-quiz</th>
            <th className={th}>AI quiz</th>
            <th className={th}>Taps</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={`${d.track} ${d.date}`} className="last:[&>td]:border-b-0">
              <td className={`${td} whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[.06em]`}>
                {dateTag(d.date)}
              </td>
              <td className={`${td} font-sans text-[#0a0a0a]`}>
                {d.title || d.date}
                {d.track === "junior" && <span className={`${chip} ml-2`}>junior</span>}
              </td>
              <td className={td}>
                <Count n={d.articleOpens} />
              </td>
              <td className={td}>{dur(d.readSeconds)}</td>
              <td className={td}>
                <Count n={d.handoutOpens} />
              </td>
              <td className={td}>
                <Count n={d.selfquizOpens} />
              </td>
              <td className={td}>
                <Check on={d.quizDone} />
              </td>
              <td className={td}>
                <Count n={d.glossTaps} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StudentsTable({
  data,
  parentNames,
}: {
  data: Analytics;
  parentNames?: Record<string, string>;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const cols = parentNames ? 11 : 10;
  const published = data.tracks
    .map((t) => `${t.readingsInWindow} ${TRACK_LABEL[t.track]}`)
    .join(", ");

  return (
    <Section
      title="By student"
      note={`Readings touched in this window, both tracks (${published} published). /N is what was published on the track(s) that person read. Read = total time on article pages. Parents follow the students. Click a row for the per-reading timeline, with junior readings marked.`}
    >
      {data.students.length === 0 ? (
        <Empty>No students in this classroom.</Empty>
      ) : (
        <div className="mt-3 overflow-x-auto border-[3px] border-[#0a0a0a] bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}></th>
                <th className={`${th} w-full`}>Who</th>
                {parentNames && <th className={th}>Parent</th>}
                <th className={th}>Articles</th>
                <th className={th}>Handouts</th>
                <th className={th}>Self-quizzes</th>
                <th className={th}>AI quizzes</th>
                <th className={th}>Word rounds</th>
                <th className={th}>Read</th>
                <th className={th}>Taps</th>
                <th className={th}>Last active</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s: StudentRow) => {
                const isOpen = open.has(s.username);
                return (
                  <StudentRows
                    key={s.username}
                    s={s}
                    isOpen={isOpen}
                    onToggle={() => toggle(s.username)}
                    parentName={
                      parentNames
                        ? s.role === "parent"
                          ? "—"
                          : parentNames[s.parentId ?? ""] ?? s.parentId ?? "—"
                        : undefined
                    }
                    cols={cols}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function StudentRows({
  s,
  isOpen,
  onToggle,
  parentName,
  cols,
}: {
  s: StudentRow;
  isOpen: boolean;
  onToggle: () => void;
  parentName?: string;
  cols: number;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer hover:bg-[#ffe600] ${isOpen ? "bg-stone-100" : ""}`}
      >
        <td className={`${td} pr-0`}>
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={isOpen ? "Collapse" : "Expand"}
            className="cursor-pointer"
          >
            <Toggle open={isOpen} />
          </button>
        </td>
        <td className={`${td} font-bold text-[#0a0a0a]`}>
          {s.username}
          {s.role === "parent" && <span className={`${chip} ml-2`}>parent</span>}
        </td>
        {parentName !== undefined && (
          <td className={`${td} text-stone-600`}>{parentName}</td>
        )}
        <td className={td}>
          <OfN n={s.articles} total={s.published} />
        </td>
        <td className={td}>
          <OfN n={s.handouts} total={s.published} />
        </td>
        <td className={td}>
          <OfN n={s.selfquizzes} total={s.published} />
        </td>
        <td className={td}>
          <OfN n={s.quizzes} total={s.published} />
        </td>
        <td className={td}>
          <Count n={s.wordRounds} />
        </td>
        <td className={`${td} whitespace-nowrap`}>{dur(s.readSeconds)}</td>
        <td className={td}>
          <Count n={s.glossTaps} />
        </td>
        <td className={`${td} whitespace-nowrap text-stone-600`}>{when(s.lastActive)}</td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={cols} className="border-b border-stone-300 bg-stone-50 px-3 py-3">
            <DaysTable days={s.days} />
          </td>
        </tr>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- export */

export default function ActivityReport({
  data,
  showAnon = false,
  parentNames,
}: {
  data: Analytics;
  showAnon?: boolean;
  parentNames?: Record<string, string>;
}) {
  const a = data.anon;
  const anyAnon = a.articleOpens + a.handoutOpens + a.selfquizOpens + a.wordbankOpens + a.glossTaps;
  return (
    <div>
      <StudentsTable data={data} parentNames={parentNames} />
      {data.tracks.map((tr) => (
        <ReadingsTable key={tr.track} tr={tr} showAnon={showAnon} />
      ))}
      {showAnon && (
        <p className="mt-3 font-sans text-[13px] text-stone-500">
          <span className={chip}>Logged out: </span>
          {anyAnon
            ? `${a.articleOpens} article · ${a.handoutOpens} handout · ${a.selfquizOpens} self-quiz · ${a.wordbankOpens} word bank · ${a.glossTaps} taps`
            : "no logged-out opens in this window"}
          <span className={muted}>
            {" "}
            — opens with no login on either track, never attributed. The
            column reads article · handout · self-quiz · taps.
          </span>
        </p>
      )}
    </div>
  );
}
