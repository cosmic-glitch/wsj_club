import Link from "next/link";
import { CompletedBy, CompletionsProvider } from "@/components/CompletedBy";
import HomeAuthBar from "@/components/HomeAuthBar";
import TodayTag from "@/components/TodayTag";
import VoiceQuizStep from "@/components/VoiceQuizStep";
import VotePoll from "@/components/VotePoll";
import { type Reading, type Track } from "@/lib/content";

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

  return (
    // Full-bleed breakout of the site-wide max-w-3xl column (the same
    // mx-[calc(50%-50vw)] trick as app/admin/layout.tsx), re-centered at the
    // mockup's 980px. -my-10 reclaims <main>'s vertical padding so the white
    // canvas runs from the global header to the site footer.
    <div className="mx-[calc(50%_-_50vw)] -my-10 w-screen bg-white pb-[90px] font-mono text-[#0a0a0a]">
      {/* ---- topline: the page's own login/scores controls ---- */}
      {/* The site-wide header is hidden on this page (see SiteHeader); these
          small text links ARE its replacement — chrome by position (the very
          top, above the masthead, under a hairline rule), quiet by type
          (plain text, so the boxed buttons stay content-only). The My Word
          Bank link lives INSIDE HomeAuthBar (next to My Scores), not here.
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
            {readings.map((r, index) => {
              // The newest reading gets the yellow row + bigger title; the
              // TODAY chip appears only when its date is actually today
              // (checked client-side in TodayTag). While a vote poll is live
              // (a preceding .vote-live sibling exists), the poll row IS the
              // highlighted "today" entry, so the newest reading's yellow/size
              // are demoted back to a normal row via sibling-selector variants.
              const newest = index === 0;

              // One set of links per source. A source with an articlePageUrl
              // (our served responsive HTML page — every new day) gets a single
              // "ARTICLE" button; historical sources without one keep the
              // legacy "WEB"/"PDF" pair. Multi-article days number each set.
              const sources =
                r.articles && r.articles.length > 0
                  ? r.articles
                  : [
                      {
                        articleUrl: r.articleUrl ?? "#",
                        pdfUrl: r.pdfUrl,
                        articlePageUrl: r.articlePageUrl,
                      },
                    ];
              const single = !(r.articles && r.articles.length > 0);

              return (
                <li
                  key={r.date}
                  className={`group grid grid-cols-1 gap-y-[6px] border-b-2 border-[#0a0a0a] px-3.5 py-3 last:border-b-0 hover:bg-[#0a0a0a] hover:text-white min-[681px]:grid-cols-[112px_1fr_max-content] min-[681px]:items-center min-[681px]:gap-4 min-[681px]:px-4 ${
                    newest ? "bg-[#ffe600] [.vote-live~&]:bg-transparent" : ""
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
                    {/* How many have finished the day's AI quiz — an inline
                        tail so it never costs a mobile row an extra line (see
                        CompletedBy). */}
                    <CompletedBy date={r.date} />
                  </span>

                  <span className="flex flex-wrap gap-[6px] min-[681px]:flex-nowrap">
                    {sources.map((a, i) =>
                      a.articlePageUrl ? (
                        // Our own responsive article page — reflows on phones
                        // (the PDF never did), so it replaces the Web + PDF
                        // pair with one button.
                        <a
                          key={a.articleUrl}
                          href={a.articlePageUrl}
                          className={btn}
                        >
                          {single ? "Article" : `Article ${i + 1}`}
                        </a>
                      ) : a.pdfUrl ? (
                        // Legacy pre-article-page day: the original Web + PDF
                        // button pair, untouched.
                        <span key={a.articleUrl} className="contents">
                          <a href={a.articleUrl} className={btn}>
                            {single ? "Web" : `Web ${i + 1}`}
                          </a>
                          <a href={a.pdfUrl} className={btn}>
                            {single ? "PDF" : `PDF ${i + 1}`}
                          </a>
                        </span>
                      ) : (
                        // Open web article (no paywall): no article page of our
                        // own — the ARTICLE button links straight to the
                        // original.
                        <a key={a.articleUrl} href={a.articleUrl} className={btn}>
                          {single ? "Article" : `Article ${i + 1}`}
                        </a>
                      ),
                    )}
                    <Link href={`${base}/reading/${r.date}`} className={btn}>
                      Handout
                    </Link>
                    {/* The voice-quiz launcher — full behavior (login gate,
                        resume probe/chooser) lives in VoiceQuiz; only the
                        visible button is restyled to match the others. */}
                    {r.voiceQuiz && (
                      <VoiceQuizStep date={r.date} track={track} className={btn} />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          </CompletionsProvider>
        )}

        <p className="mt-5 text-center text-[11px] uppercase tracking-[.14em]">
          READ → HANDOUT → QUIZ. REPEAT TOMORROW.
        </p>
      </div>
    </div>
  );
}
