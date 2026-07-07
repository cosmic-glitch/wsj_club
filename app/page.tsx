import Link from "next/link";
import ArticleLink from "@/components/ArticleLink";
import VoiceQuizStep from "@/components/VoiceQuizStep";
import { getAllReadings, dateBig } from "@/lib/content";

// One shared blue-link style so every link on the page matches.
const linkClass = "text-sky-700 transition hover:text-sky-900 hover:underline";

// The middot that separates actions in a row's compact action bar. Its
// horizontal margin is generous so each action reads as a distinct tap target
// with clear breathing room — especially on a phone, where the bar wraps.
function Sep() {
  return (
    <span className="mx-2.5 text-stone-300" aria-hidden>
      ·
    </span>
  );
}

export default function Home() {
  const readings = getAllReadings();

  if (readings.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">
        No readings yet. The first one will appear here.
      </p>
    );
  }

  return (
    // A compact, table-like list: one row per day inside a single bordered card,
    // hairline dividers between days. Each row is the date + title on a prominent
    // line, then a small "action bar" of text links below. The action bar WRAPS
    // on narrow screens (it never scrolls horizontally), which is why this beats
    // a real <table> on mobile — a table would force shared column widths and
    // horizontal scroll on a phone.
    <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      {readings.map((r) => {
        // One link per source. Single-article days have one ("Article"); multi-
        // article days have "Article 1", "Article 2", … each with its own PDF.
        const sources =
          r.articles && r.articles.length > 0
            ? r.articles
            : [{ articleUrl: r.articleUrl ?? "#", pdfUrl: r.pdfUrl }];
        const single = !(r.articles && r.articles.length > 0);

        return (
          <li key={r.date} className="px-4 py-3 sm:px-5">
            {/* Date + title — the prominent line. The title is the anchor (plain
                text, not a link); the date is a muted serif label before it. */}
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              <span className="shrink-0 font-serif text-sm font-bold text-stone-500">
                {dateBig(r.date)}
              </span>
              <span className="font-medium leading-snug text-stone-900">
                {r.title}
              </span>
            </div>

            {/* Optional per-day reading note (e.g. "read the Concepts first").
                Sits right under the title (context about the article), above the
                actions. Muted and indented so it's a quiet aside, not an
                attention-grab: a "Note:" label + a small left tab off the
                heading's edge. */}
            {r.note && (
              <p className="mt-1.5 pl-4 text-sm text-stone-500">
                <span className="font-medium">Note:</span> {r.note}
              </p>
            )}

            {/* Compact action bar — text links separated by middots: Web link ·
                PDF · Handout · Voice quiz. The PDF is its own item (not a "(PDF)"
                aside) so each link is a clear, separately tappable target. */}
            <div className="mt-1 text-sm text-stone-600">
              {sources.map((a, i) => (
                <span key={a.articleUrl}>
                  {i > 0 && <Sep />}
                  <ArticleLink href={a.articleUrl} className={linkClass}>
                    {single ? "Web link" : `Web link ${i + 1}`}
                  </ArticleLink>
                  {a.pdfUrl && (
                    <>
                      <Sep />
                      <a
                        href={a.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClass}
                      >
                        {single ? "PDF" : `PDF ${i + 1}`}
                      </a>
                    </>
                  )}
                </span>
              ))}
              <Sep />
              <Link href={`/reading/${r.date}`} className={linkClass}>
                Handout
              </Link>
              {/* Login-gated + voiceQuiz-only; renders its own leading middot
                  when shown, nothing when signed out. */}
              {r.voiceQuiz && <VoiceQuizStep date={r.date} title={r.title} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
