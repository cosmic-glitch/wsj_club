import Link from "next/link";
import ArticleLink from "@/components/ArticleLink";
import { getAllReadings, dateBig } from "@/lib/content";

// One shared blue-link style so every link on the page matches.
const linkClass = "text-sky-700 transition hover:text-sky-900 hover:underline";

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
    <ul className="space-y-6">
      {readings.map((r) => (
        <li
          key={r.date}
          className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm"
        >
          {/* The date */}
          <div className="font-serif text-2xl font-bold text-stone-900">
            {dateBig(r.date)}
          </div>

          {/* The article title — plain text, not a link */}
          <p className="mt-1.5 text-lg font-medium leading-snug text-stone-900">
            {r.title}
          </p>

          {/* The four steps — the same every day */}
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-stone-700 marker:font-semibold marker:text-stone-400">
            <li>
              Read the{" "}
              <ArticleLink href={r.articleUrl} className={linkClass}>
                article
              </ArticleLink>
              {r.pdfUrl && (
                <>
                  {" "}
                  (
                  <a
                    href={r.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkClass}
                  >
                    PDF version
                  </a>
                  )
                </>
              )}
            </li>
            <li>
              Read the{" "}
              <Link href={`/reading/${r.date}`} className={linkClass}>
                handout
              </Link>
            </li>
            <li>
              Take the{" "}
              <Link href={`/reading/${r.date}/quiz`} className={linkClass}>
                self-quiz
              </Link>
            </li>
            <li>
              Schedule your{" "}
              <a
                href="https://calendly.com/cosmic-glitch/daily-quiz"
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                1-1 quiz
              </a>
            </li>
          </ol>
        </li>
      ))}
    </ul>
  );
}
