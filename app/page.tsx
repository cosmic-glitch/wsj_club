import Link from "next/link";
import ArticleLink from "@/components/ArticleLink";
import VoiceQuiz from "@/components/VoiceQuiz";
import VoiceColumnGate from "@/components/VoiceColumnGate";
import { getAllReadings, dateBig, type Reading } from "@/lib/content";

// One shared blue-link style so every link on the page matches.
const linkClass = "text-sky-700 transition hover:text-sky-900 hover:underline";

/**
 * The article link(s) for a row. Single-article days show one "Article" link
 * (plus "PDF" when a served PDF exists); multi-article days list each one.
 */
function ArticleCell({ r }: { r: Reading }) {
  if (r.articles && r.articles.length > 0) {
    return (
      <div className="space-y-1.5">
        {r.articles.map((a, i) => (
          <div key={a.articleUrl} className="whitespace-nowrap">
            <ArticleLink href={a.articleUrl} className={linkClass}>
              Article {i + 1}
            </ArticleLink>
            {a.pdfUrl && (
              <>
                {" · "}
                <a
                  href={a.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  PDF
                </a>
              </>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <span className="whitespace-nowrap">
      <ArticleLink href={r.articleUrl ?? "#"} className={linkClass}>
        Article
      </ArticleLink>
      {r.pdfUrl && (
        <>
          {" · "}
          <a
            href={r.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            PDF
          </a>
        </>
      )}
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
    <VoiceColumnGate>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Article</th>
            <th className="px-4 py-3">Handout</th>
            <th className="px-4 py-3">Self-quiz</th>
            <th className="hidden px-4 py-3 group-data-[authed]:table-cell">
              Voice quiz
            </th>
          </tr>
        </thead>
        <tbody>
          {readings.map((r) => (
            <tr
              key={r.date}
              className="border-b border-stone-100 align-top last:border-0"
            >
              <td className="whitespace-nowrap px-4 py-4 font-medium text-stone-900">
                {dateBig(r.date)}
              </td>
              <td className="px-4 py-4 font-medium leading-snug text-stone-900">
                {r.title}
              </td>
              <td className="px-4 py-4">
                <ArticleCell r={r} />
              </td>
              <td className="whitespace-nowrap px-4 py-4">
                <Link href={`/reading/${r.date}`} className={linkClass}>
                  Handout
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-4">
                <Link href={`/reading/${r.date}/quiz`} className={linkClass}>
                  Self-quiz
                </Link>
              </td>
              <td className="hidden px-4 py-4 group-data-[authed]:table-cell">
                {r.voiceQuiz ? (
                  <VoiceQuiz date={r.date} title={r.title} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </VoiceColumnGate>
  );
}
