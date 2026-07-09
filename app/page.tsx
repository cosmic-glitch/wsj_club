import Link from "next/link";
import ArticleLink from "@/components/ArticleLink";
import HomeAuthBar from "@/components/HomeAuthBar";
import TodayTag from "@/components/TodayTag";
import VoiceQuizStep from "@/components/VoiceQuizStep";
import { getAllReadings } from "@/lib/content";

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

export default function Home() {
  const readings = getAllReadings();

  return (
    // Full-bleed breakout of the site-wide max-w-3xl column (the same
    // mx-[calc(50%-50vw)] trick as app/admin/layout.tsx), re-centered at the
    // mockup's 980px. -my-10 reclaims <main>'s vertical padding so the white
    // canvas runs from the global header to the site footer. Only this page
    // changes; the header/footer and every inner page stay as they were.
    <div className="mx-[calc(50%_-_50vw)] -my-10 w-screen bg-white pb-[90px] font-mono text-[#0a0a0a]">
      {/* ---- topline: the page's own login/scores controls ---- */}
      {/* The site-wide header is hidden on this page (see SiteHeader); these
          small text links ARE its replacement — chrome by position (the very
          top, above the masthead, under a hairline rule), quiet by type
          (plain text, so the boxed buttons stay content-only). */}
      <div className="mx-auto max-w-[980px] px-[18px]">
        <div className="flex min-h-[37px] items-center justify-end border-b-2 border-[#0a0a0a] py-1">
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
                      Handout
                    </Link>
                    {/* The voice-quiz launcher — full behavior (login gate,
                        resume probe/chooser) lives in VoiceQuiz; only the
                        visible button is restyled to match the others. */}
                    {r.voiceQuiz && (
                      <VoiceQuizStep date={r.date} className={btn} />
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
