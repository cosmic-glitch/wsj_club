import Link from "next/link";
import HomeAuthBar from "@/components/HomeAuthBar";
import { MedalsProvider, RowMedal } from "@/components/Medals";
import MoreReadings from "@/components/MoreReadings";
import StreakStrip from "@/components/StreakStrip";
import TodayTag from "@/components/TodayTag";
import VoiceQuizStep from "@/components/VoiceQuizStep";
import LevelTabs from "@/components/LevelTabs";
import { type Reading, type Track } from "@/lib/content";
import { TRACKS, TRACK_LABEL, trackBase } from "@/lib/track";

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

/**
 * One level's card in the newest-readings row: the level as its black head
 * (with the viewer's medal for the reading), the title, the three steps. The
 * date lives ONCE, in the section heading above the cards; a card carries its
 * own date only when its reading is older than that (a level that hasn't
 * published the newest day yet), and then it drops the yellow.
 */
function LevelCard({ r, track, latest }: { r: Reading | undefined; track: Track; latest: string }) {
  const current = r?.date === latest;
  return (
    <section
      aria-label={TRACK_LABEL[track]}
      className={`group flex flex-col border-[3px] border-[#0a0a0a] ${current ? "bg-[#ffe600]" : "bg-white"} hover:bg-[#0a0a0a] hover:text-white`}
    >
      <h3 className="flex items-center bg-[#0a0a0a] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[.14em] text-[#ffe600]">
        {TRACK_LABEL[track]}
        {r && <RowMedal date={r.date} className="ml-auto text-[13px]" />}
      </h3>
      {r ? (
        <div className="flex flex-1 flex-col px-3 pb-3 pt-2">
          {!current && (
            <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[.08em] text-stone-500 group-hover:text-stone-400">
              {dateTag(r.date)}
            </p>
          )}
          <p className="font-sans text-[16px] font-bold leading-[1.3] tracking-[-.01em] group-hover:text-[#ffe600]">
            {r.title}
          </p>
          {/* mt-auto: the steps sit on the card's bottom edge, so the three
              cards' buttons line up however long each title runs. */}
          <ReadingSteps r={r} track={track} className="mt-auto pt-2.5" />
        </div>
      ) : (
        <p className="px-3 py-2.5 font-sans text-[14px] text-stone-500">
          The first reading will appear here.
        </p>
      )}
    </section>
  );
}

/** Article → Handout → AI quiz, the day's sequence (shared by cards and rows). */
function ReadingSteps({ r, track, className = "" }: { r: Reading; track: Track; className?: string }) {
  const base = trackBase(track);
  return (
    <span className={`flex flex-wrap gap-[6px] ${className}`}>
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
      {/* The voice-quiz launcher — full behavior (login gate, resume
          probe/chooser) lives in VoiceQuiz; only the button is restyled. */}
      {r.voiceQuiz && (
        <>
          <span aria-hidden="true" className={stepArrow}>
            →
          </span>
          <VoiceQuizStep date={r.date} title={r.title} track={track} className={btn} />
        </>
      )}
    </span>
  );
}

/** One archive row: date + medal, title, the three steps. */
function ArchiveRow({ r, track }: { r: Reading; track: Track }) {
  return (
    <li className="group grid grid-cols-1 gap-y-[6px] border-b-2 border-[#0a0a0a] px-3.5 py-3 last:border-b-0 hover:bg-[#0a0a0a] hover:text-white min-[681px]:grid-cols-[112px_1fr_max-content] min-[681px]:items-center min-[681px]:gap-4 min-[681px]:px-4">
      <span className="whitespace-nowrap text-xs font-bold uppercase tracking-[.06em] max-[680px]:flex max-[680px]:items-center">
        {dateTag(r.date)}
        {/* The viewer's medal for the day (🥉/🥈/🥇) — the same state the
            streak ribbon's square shows; nothing for logged-out visitors. */}
        <RowMedal date={r.date} className="ml-2 text-[13px]" />
      </span>
      {/* Title in the readable sans — the label/button layer stays mono. */}
      <span className="min-w-0 font-sans text-[14.5px] font-bold leading-[1.35] tracking-[-.01em]">
        {r.title}
      </span>
      <ReadingSteps r={r} track={track} className="min-[681px]:flex-nowrap" />
    </li>
  );
}

/**
 * The home page — ONE page for all three levels (High School, Middle School,
 * Elementary), at "/" (the old per-level URLs redirect here). Top to bottom:
 * the topline (auth links), the Anton masthead, the viewer's ONE streak
 * ribbon (logged in), the deck, then the newest day — its date said once,
 * then a compact card per level — then OLDER READINGS, the per-level archive
 * behind LevelTabs (each level's newest reading lives only in its card).
 *
 * Medals: every MedalsProvider of a level shares one /api/medals request
 * (Medals.tsx), and the streak ribbon rides the High School one (the streak
 * is the same in every level's response).
 */
export default function LandingIndex({
  readings,
}: {
  readings: Record<Track, Reading[]>;
}) {
  // The newest date any level has published — the one date the cards share.
  const latest = TRACKS.map((t) => readings[t][0]?.date ?? "").sort().reverse()[0] ?? "";
  // The club days, newest first: the streak ribbon's squares.
  const clubDays = [...new Set(TRACKS.flatMap((t) => readings[t].map((r) => r.date)))]
    .sort()
    .reverse();

  const panel = (t: Track) => {
    const list = readings[t].slice(1); // the newest is in its card above
    const upfront = list.slice(0, VISIBLE_COUNT);
    const older = list.slice(VISIBLE_COUNT);
    return (
      <MedalsProvider track={t}>
        {list.length === 0 ? (
          <p className="border-[3px] border-[#0a0a0a] p-8 text-center text-sm font-bold uppercase tracking-[.08em]">
            No older {TRACK_LABEL[t].toLowerCase()} readings yet.
          </p>
        ) : (
          <ul className="border-[3px] border-[#0a0a0a]">
            {upfront.map((r) => (
              <ArchiveRow key={r.date} r={r} track={t} />
            ))}
            {older.length > 0 && (
              <MoreReadings count={older.length}>
                {older.map((r) => (
                  <ArchiveRow key={r.date} r={r} track={t} />
                ))}
              </MoreReadings>
            )}
          </ul>
        )}
      </MedalsProvider>
    );
  };

  const sectionLabel =
    "mt-[30px] mb-2.5 flex items-center font-mono text-[12px] font-bold uppercase tracking-[.2em] text-[#0a0a0a]";

  return (
    // Full-bleed breakout of the site-wide max-w-3xl column (the same
    // mx-[calc(50%-50vw)] trick as app/(site)/admin/layout.tsx), re-centered
    // at 980px. -my-10 reclaims <main>'s vertical padding so the white canvas
    // runs from the top to the site footer.
    <div className="mx-[calc(50%_-_50vw)] -my-10 w-screen bg-white pb-[90px] font-mono text-[#0a0a0a]">
      {/* ---- topline: the page's own login/reports controls ----
          (the site-wide header isn't mounted on this page; these small text
          links are its replacement). relative z-10: the masthead's Anton line
          box overflows upward past the <header> and would otherwise paint
          over this bar and eat clicks. */}
      <div className="relative z-10 mx-auto max-w-[980px] px-[18px]">
        <div className="flex min-h-[37px] items-center justify-end gap-4 border-b-2 border-[#0a0a0a] py-1">
          <HomeAuthBar />
        </div>
      </div>

      {/* ---- masthead ---- */}
      <header className="animate-brutal-stamp border-b-[5px] border-[#0a0a0a] motion-reduce:animate-none">
        <div className="mx-auto max-w-[980px] px-[18px]">
          <h1 className="pt-4 pb-2 font-display text-[clamp(56px,12.5vw,128px)] font-normal uppercase leading-[.95] tracking-[.01em]">
            READING{" "}
            <span className="text-transparent [-webkit-text-stroke:2px_#0a0a0a]">
              CLUB
            </span>
          </h1>
        </div>
      </header>

      {/* ---- the viewer's one streak, across every level (nothing logged out) ---- */}
      <MedalsProvider track="senior">
        <StreakStrip dates={clubDays} />
      </MedalsProvider>

      <div className="mx-auto max-w-[980px] px-[18px]">
        {/* The deck: what this is, in the two seconds a newcomer gives us. */}
        <div className="mt-[17px] animate-brutal-stamp-delayed border-[3px] border-[#0a0a0a] p-4 shadow-[6px_6px_0_#ffe600,6px_6px_0_3px_#0a0a0a] motion-reduce:animate-none">
          <p className="font-sans text-[14.5px] leading-relaxed text-[#0a0a0a]">
            One hand-picked article a day for high schoolers, middle schoolers
            and elementary schoolers. Every day you read earns a medal: bronze
            🥉 for reading the article, silver 🥈 for reading the handout, gold
            🥇 for explaining it to an AI tutor. A medal on any level keeps
            your streak alive.{" "}
            <Link
              href="/guide"
              className="ml-2 whitespace-nowrap font-mono text-[11.5px] font-bold uppercase tracking-[.08em] underline decoration-2 underline-offset-4 hover:bg-[#ffe600]"
            >
              How it works →
            </Link>
          </p>
        </div>

        {/* ---- the newest day, every level: the date said once ---- */}
        {latest && (
          <h2 className={sectionLabel}>
            {dateTag(latest)}
            <TodayTag date={latest} />
          </h2>
        )}
        <div className="grid animate-brutal-stamp-delayed grid-cols-1 gap-3 motion-reduce:animate-none min-[820px]:grid-cols-3 min-[820px]:gap-4">
          {TRACKS.map((t) => (
            <MedalsProvider key={t} track={t}>
              <LevelCard r={readings[t][0]} track={t} latest={latest} />
            </MedalsProvider>
          ))}
        </div>

        {/* ---- the archive, by level ---- */}
        <h2 className={sectionLabel}>Older readings</h2>
        <LevelTabs
          panels={{ senior: panel("senior"), junior: panel("junior"), kids: panel("kids") }}
        />

        {/* Spells out the same three steps the rows' arrows imply — the rows
            have only room for the nouns, so the verbs live here. */}
        <p className="mt-5 text-center text-[11px] uppercase tracking-[.14em]">
          Read the article → Study the handout → Mark it done or take the AI
          quiz. Repeat tomorrow.
        </p>
      </div>
    </div>
  );
}
