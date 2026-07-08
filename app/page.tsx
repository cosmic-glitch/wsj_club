import Link from "next/link";
import { Anton, Space_Mono } from "next/font/google";
import ArticleLink from "@/components/ArticleLink";
import TodayTag from "@/components/TodayTag";
import VoiceQuizStep from "@/components/VoiceQuizStep";
import { getAllReadings, getAnnouncements } from "@/lib/content";

// The landing page's own display faces — scoped here (applied inside this
// page's wrapper), so inner pages keep the site-wide Geist/Georgia setup.
// Palette: pure white canvas, near-black #0a0a0a ink, signal-yellow #ffe600.
const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
});
const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
});

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

// One half of the seamless marquee loop (the whole strip is two identical
// halves and the animation travels -50%). The second copy is aria-hidden.
function MarqueeHalf({
  messages,
  ariaHidden,
}: {
  messages: string[];
  ariaHidden?: boolean;
}) {
  return (
    <span aria-hidden={ariaHidden}>
      <b className="mr-[18px] ml-[30px] bg-[#0a0a0a] px-[10px] py-[2px] text-[10.5px] tracking-[.2em] text-[#ffe600]">
        Announcement
      </b>
      {messages.map((message, i) => (
        <span key={message}>
          {i > 0 && (
            <span className="mx-[14px]" aria-hidden>
              ★
            </span>
          )}
          {message}
        </span>
      ))}
      <span className="mx-[14px]" aria-hidden>
        ★★★
      </span>
    </span>
  );
}

export default function Home() {
  const readings = getAllReadings();
  const announcements = getAnnouncements();

  return (
    // Full-bleed breakout of the site-wide max-w-3xl column (the same
    // mx-[calc(50%-50vw)] trick as app/admin/layout.tsx), re-centered at the
    // mockup's 980px. -my-10 reclaims <main>'s vertical padding so the white
    // canvas runs from the global header to the site footer. Only this page
    // changes; the header/footer and every inner page stay as they were.
    <div
      className={`${anton.variable} ${spaceMono.variable} mx-[calc(50%_-_50vw)] -my-10 w-screen bg-white pb-[90px] text-[#0a0a0a] [font-family:var(--font-space-mono),monospace]`}
    >
      {/* ---- masthead ---- */}
      <header className="animate-brutal-stamp border-b-[5px] border-[#0a0a0a] motion-reduce:animate-none">
        <div className="mx-auto max-w-[980px] px-[18px]">
          <h1 className="pt-4 pb-2 text-[clamp(56px,12.5vw,128px)] font-normal uppercase leading-[.95] tracking-[.01em] [font-family:var(--font-anton),sans-serif]">
            READING{" "}
            <span className="text-transparent [-webkit-text-stroke:2px_#0a0a0a]">
              CLUB
            </span>
          </h1>
        </div>
      </header>

      {/* ---- announcement ticker ---- */}
      {announcements.length > 0 && (
        <>
          {/* The scrolling marquee (paused on hover). Hidden for
              prefers-reduced-motion users, who get the static strip below. */}
          <div className="group overflow-hidden whitespace-nowrap border-b-[5px] border-[#0a0a0a] bg-[#ffe600] py-[7px] text-xs font-bold uppercase tracking-[.1em] motion-reduce:hidden">
            <div className="inline-block animate-brutal-scroll group-hover:[animation-play-state:paused]">
              <MarqueeHalf messages={announcements} />
              <MarqueeHalf messages={announcements} ariaHidden />
            </div>
          </div>
          {/* Static reduced-motion fallback: same yellow strip, messages
              simply wrap instead of scrolling. */}
          <div className="hidden border-b-[5px] border-[#0a0a0a] bg-[#ffe600] py-[7px] text-xs font-bold uppercase tracking-[.1em] motion-reduce:block">
            <div className="mx-auto max-w-[980px] px-[18px]">
              <b className="mr-[18px] bg-[#0a0a0a] px-[10px] py-[2px] text-[10.5px] tracking-[.2em] text-[#ffe600]">
                Announcement
              </b>
              {announcements.map((message, i) => (
                <span key={message}>
                  {i > 0 && (
                    <span className="mx-[14px]" aria-hidden>
                      ★
                    </span>
                  )}
                  {message}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ---- index ---- */}
      <div className="mx-auto max-w-[980px] px-[18px]">
        {readings.length === 0 ? (
          <p className="mt-[26px] border-[3px] border-[#0a0a0a] p-8 text-center text-sm font-bold uppercase tracking-[.08em]">
            No readings yet. The first one will appear here.
          </p>
        ) : (
          <ul className="mt-[26px] animate-brutal-stamp-delayed border-[3px] border-[#0a0a0a] motion-reduce:animate-none">
            {readings.map((r, index) => {
              // The newest reading gets the yellow row + bigger title; the
              // TODAY chip appears only when its date is actually today
              // (checked client-side in TodayTag).
              const newest = index === 0;

              // One set of links per source. Single-article days have one
              // ("WEB"/"PDF"); multi-article days number each pair.
              const sources =
                r.articles && r.articles.length > 0
                  ? r.articles
                  : [{ articleUrl: r.articleUrl ?? "#", pdfUrl: r.pdfUrl }];
              const single = !(r.articles && r.articles.length > 0);

              return (
                <li
                  key={r.date}
                  className={`group grid grid-cols-1 gap-y-[6px] border-b-2 border-[#0a0a0a] px-3.5 py-3 last:border-b-0 hover:bg-[#0a0a0a] hover:text-white min-[681px]:grid-cols-[112px_1fr_max-content] min-[681px]:items-center min-[681px]:gap-4 min-[681px]:px-4 ${
                    newest ? "bg-[#ffe600]" : ""
                  }`}
                >
                  <span
                    className={`whitespace-nowrap text-xs font-bold uppercase tracking-[.06em] ${
                      newest ? "group-hover:text-[#ffe600]" : ""
                    }`}
                  >
                    {dateTag(r.date)}
                    {newest && <TodayTag date={r.date} />}
                  </span>

                  <span
                    className={`min-w-0 font-bold leading-[1.35] ${
                      newest
                        ? "text-[19px] group-hover:text-[#ffe600]"
                        : "text-[14.5px]"
                    }`}
                  >
                    {r.title}
                  </span>

                  <span className="flex flex-wrap gap-[6px] min-[681px]:flex-nowrap">
                    {sources.map((a, i) => (
                      <span key={a.articleUrl} className="contents">
                        <ArticleLink href={a.articleUrl} className={btn}>
                          {single ? "Web" : `Web ${i + 1}`}
                        </ArticleLink>
                        {a.pdfUrl && (
                          <a
                            href={a.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={btn}
                          >
                            {single ? "PDF" : `PDF ${i + 1}`}
                          </a>
                        )}
                      </span>
                    ))}
                    <Link href={`/reading/${r.date}`} className={btn}>
                      Hand
                    </Link>
                    {/* The voice-quiz launcher — full behavior (login gate,
                        resume probe/chooser) lives in VoiceQuiz; only the
                        visible button is restyled to match the others. */}
                    {r.voiceQuiz && (
                      <VoiceQuizStep
                        date={r.date}
                        title={r.title}
                        className={btn}
                      />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-5 text-center text-[11px] uppercase tracking-[.14em]">
          READ → HANDOUT → QUIZ. REPEAT TOMORROW.
        </p>
      </div>
    </div>
  );
}
