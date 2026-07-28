import Link from "next/link";
import { CompletedBy, CompletionsProvider } from "@/components/CompletedBy";
import HomeAuthBar from "@/components/HomeAuthBar";
import MoreReadings from "@/components/MoreReadings";
import StreakStrip from "@/components/StreakStrip";
import TodayTag from "@/components/TodayTag";
import VoiceQuizStep from "@/components/VoiceQuizStep";
import VotePoll from "@/components/VotePoll";
import { type Reading, type Track } from "@/lib/content";

// How many rows the index shows up front; everything older collapses behind
// the MoreReadings "show more" row at the bottom of the list.
const VISIBLE_COUNT = 10;

/** "2026-07-08" → "Jul 8" (rendered uppercase — the mockup's "JUL 8"). */
function dateTag(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// One boxed uppercase action button. Base = mobile (bigger tap target,
// 5px 10px); ≥681px matches the mockup's 3px 8px. The row is a `group`:
// hovering the row inverts it (black bg), so the buttons flip to white
// borders/text, and hovering a button inside a hovered row goes yellow.
const btn =
  "inline-block cursor-pointer border-2 border-[#0a0a0a] px-[10px] py-[5px] text-[10.5px] font-bold uppercase leading-normal tracking-[.08em] text-[#0a0a0a] no-underline min-[681px]:px-2 min-[681px]:py-[3px] group-hover:border-white group-hover:text-white group-hover:hover:border-[#ffe600] group-hover:hover:bg-[#ffe600] group-hover:hover:text-[#0a0a0a]";

// The "→" separating the row's action groups. A day is a sequence — read the
// article, then the handout, then the AI quiz — but three identical boxes read
// as three alternatives, so the arrows carry the order. Decorative only
// (aria-hidden): the buttons are already in sequence in the DOM. No arrow goes
// *between* source buttons on a multi-article day — those are parallel, not
// steps.
const stepArrow =
  "self-center text-[11px] font-bold leading-none text-stone-500 group-hover:text-stone-400";

// A quiet topline text link (the "← Main club" / "Word bank" chrome links).
const topLink =
  "px-1.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[.12em] text-stone-500 no-underline hover:bg-[#0a0a0a] hover:text-[#ffe600]";

// The landing / index body, shared by the senior ("/") and junior ("/junior")
// tracks: a thin topline (auth links), the big Anton masthead, then the readings
// as rows in one thick-bordered list. The newest row is yellow; rows invert to
// black on hover. `track` selects which track this index belongs to — it drives
// the track prefix on the per-row Handout / Voice quiz actions and (junior only)
// the masthead label + the cross-track link.
export default function LandingIndex({
  readings,
  track = "senior",
}: {
  readings: Reading[];
  track?: Track;
}) {
  const junior = track === "junior";
  const base = junior ? "/junior" : "";

  // One index row. `index` is the reading's absolute position in the full
  // newest-first list (so the newest-row styling can never land on a row
  // revealed from the collapsed tail).
  const renderRow = (r: Reading, index: number) => {
    // The newest reading gets the yellow row + bigger title; the
    // TODAY chip appears only when its date is actually today
    // (checked client-side in TodayTag). While a vote poll is live
    // (a preceding .vote-live sibling exists), the poll row IS the
    // highlighted "today" entry, so the newest reading's yellow/size
    // are demoted back to a normal row via sibling-selector variants.
    const newest = index === 0;

    return (
      <li
        key={r.date}
        className={`group grid grid-cols-1 gap-y-[6px] border-b-2 border-[#0a0a0a] px-3.5 py-3 last:border-b-0 hover:bg-[#0a0a0a] hover:text-white min-[681px]:grid-cols-[112px_1fr_max-content] min-[681px]:items-center min-[681px]:gap-4 min-[681px]:px-4 ${
          newest ? "bg-[#ffe600] [.vote-live~&]:bg-transparent" : ""
        }`}
      >
        <span
          className={`whitespace-nowrap text-xs font-bold uppercase tracking-[.06em] max-[680px]:flex max-[680px]:items-center ${
            newest ? "group-hover:text-[#ffe600]" : ""
          }`}
        >
          {dateTag(r.date)}
          {newest && <TodayTag date={r.date} />}
          {/* Mobile home of the completed-count: RIGHT-ALIGNED on
              the date line (ml-auto in the mobile-only flex row) so
              it doesn't crowd the date + TODAY chip; the action bar
              has no slack at all (see CompletedBy). */}
          <CompletedBy
            date={r.date}
            className="ml-auto pl-2 min-[681px]:hidden"
          />
        </span>

        {/* Title in the readable sans — sentence-length text reads
            badly in the mono UI face; the label/button layer stays
            mono (the chip below opts back in). */}
        <span
          className={`min-w-0 font-sans font-bold leading-[1.35] tracking-[-.01em] ${
            newest
              ? "text-[19px] group-hover:text-[#ffe600] [.vote-live~li_&]:text-[14.5px]"
              : "text-[14.5px]"
          }`}
        >
          {r.title}
          {/* The day's article was chosen by the club's vote. */}
          {r.clubPick && (
            <span className="ml-2 inline-block whitespace-nowrap border-2 border-[#0a0a0a] px-[5px] py-[1px] align-[2px] font-mono text-[9px] font-bold uppercase tracking-[.14em] group-hover:border-white group-hover:text-white">
              Club pick
            </span>
          )}
        </span>

        <span className="flex flex-wrap gap-[6px] min-[681px]:flex-nowrap">
          {/* A day is one article: our own served page when we have one (every
              new day does — it's what carries the glossary), otherwise straight
              to the publisher. */}
          <a href={r.articlePageUrl ?? r.articleUrl ?? "#"} className={btn}>
            Article
          </a>
          <span aria-hidden="true" className={stepArrow}>
            →
          </span>
          <Link href={`${base}/reading/${r.date}`} className={btn}>
            Handout
          </Link>
          {/* The voice-quiz launcher — full behavior (login gate,
              resume probe/chooser) lives in VoiceQuiz; only the
              visible button is restyled to match the others. */}
          {r.voiceQuiz && (
            <>
              <span aria-hidden="true" className={stepArrow}>
                →
              </span>
              <VoiceQuizStep
                date={r.date}
                title={r.title}
                track={track}
                className={btn}
              />
            </>
          )}
          {/* Desktop home of the completed-count: the slack right
              of the AI QUIZ button (kept off the title, which it
              polluted; see CompletedBy). */}
          <CompletedBy
            date={r.date}
            className="hidden self-center min-[681px]:inline"
          />
        </span>
      </li>
    );
  };

  // Only the newest VISIBLE_COUNT rows render up front; the tail is still
  // server-rendered but stays collapsed behind the "show more" row.
  const upfront = readings.slice(0, VISIBLE_COUNT);
  const older = readings.slice(VISIBLE_COUNT);

  return (
    // Full-bleed breakout of the site-wide max-w-3xl column (the same
    // mx-[calc(50%-50vw)] trick as app/admin/layout.tsx), re-centered at the
    // mockup's 980px. -my-10 reclaims <main>'s vertical padding so the white
    // canvas runs from the global header to the site footer.
    <div className="mx-[calc(50%_-_50vw)] -my-10 w-screen bg-white pb-[90px] font-mono text-[#0a0a0a]">
      {/* ---- topline: the page's own login/reports controls ---- */}
      {/* The site-wide header is hidden on this page (see SiteHeader); these
          small text links ARE its replacement — chrome by position (the very
          top, above the masthead, under a hairline rule), quiet by type
          (plain text, so the boxed buttons stay content-only). The My Word
          Bank link lives INSIDE HomeAuthBar (next to Reports), not here.
          On junior a quiet cross-link back to the main club sits at the
          left. */}
      <div className="mx-auto max-w-[980px] px-[18px]">
        <div
          className={`flex min-h-[37px] items-center border-b-2 border-[#0a0a0a] py-1 ${
            junior ? "justify-between gap-4" : "justify-end"
          }`}
        >
          {junior && (
            <Link href="/" className={topLink}>
              ← Main club
            </Link>
          )}
          <HomeAuthBar />
        </div>
      </div>

      {/* ---- masthead ---- */}
      <header className="animate-brutal-stamp border-b-[5px] border-[#0a0a0a] motion-reduce:animate-none">
        <div className="mx-auto max-w-[980px] px-[18px]">
          {junior && (
            <p className="pt-4 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-stone-500">
              Junior · Grades 5–7
            </p>
          )}
          <h1
            className={`${
              junior ? "pt-1" : "pt-4"
            } pb-2 font-display text-[clamp(56px,12.5vw,128px)] font-normal uppercase leading-[.95] tracking-[.01em]`}
          >
            READING{" "}
            <span className="text-transparent [-webkit-text-stroke:2px_#0a0a0a]">
              CLUB
            </span>
          </h1>
        </div>
      </header>

      {/* The logged-in student's personal streak ribbon (students only —
          renders nothing for parents / logged-out visitors). */}
      <StreakStrip track={track} dates={readings.map((r) => r.date)} />

      {/* ---- index ---- */}
      <div className="mx-auto max-w-[980px] px-[18px]">
        {readings.length === 0 ? (
          <p className="mt-[26px] border-[3px] border-[#0a0a0a] p-8 text-center text-sm font-bold uppercase tracking-[.08em]">
            {junior
              ? "No junior readings yet. The first one will appear here."
              : "No readings yet. The first one will appear here."}
          </p>
        ) : (
          <CompletionsProvider track={track}>
          <ul className="mt-[26px] animate-brutal-stamp-delayed border-[3px] border-[#0a0a0a] motion-reduce:animate-none">
            {/* The daily article vote (each track shows its own poll): a
                client row that pops in as the FIRST entry while a poll is live
                and renders nothing otherwise. Its `vote-live` class is what
                the [.vote-live~&] variants below key off to demote the
                previous newest row. */}
            <VotePoll track={track} />
            {upfront.map(renderRow)}
            {older.length > 0 && (
              <MoreReadings count={older.length}>
                {older.map((r, i) => renderRow(r, i + VISIBLE_COUNT))}
              </MoreReadings>
            )}
          </ul>
          </CompletionsProvider>
        )}

        {/* Spells out the same three steps the row's arrows imply — the row
            has only room for the nouns, so the verbs live here. */}
        <p className="mt-5 text-center text-[11px] uppercase tracking-[.14em]">
          Read the article → Study the handout → Take the AI quiz. Repeat
          tomorrow.
        </p>
      </div>
    </div>
  );
}
