import Link from "next/link";
import ArticleLink from "@/components/ArticleLink";
import { getAllReadings, dateBig, dateSmall } from "@/lib/content";

export default function Home() {
  const readings = getAllReadings();

  return (
    <div>
      <p className="mb-8 text-stone-600">
        <span className="font-medium text-stone-900">Each day, in order:</span>{" "}
        read today&rsquo;s article → read the handout → take the quiz → call
        Anurag.
      </p>

      {readings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">
          No readings yet. The first one will appear here.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          {/* Column headers (shown on wider screens) */}
          <div className="hidden grid-cols-[10rem_1fr_auto_auto] gap-4 border-b border-stone-200 bg-stone-50 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-stone-400 sm:grid">
            <div>Date</div>
            <div>Article</div>
            <div className="text-right">Handout</div>
            <div className="text-right">Quiz</div>
          </div>

          <ul className="divide-y divide-stone-200">
            {readings.map((r) => (
              <li
                key={r.date}
                className="grid grid-cols-1 gap-4 px-6 py-6 sm:grid-cols-[10rem_1fr_auto_auto] sm:items-center"
              >
                {/* Date — prominent */}
                <div>
                  <div className="font-serif text-2xl font-bold leading-none text-stone-900">
                    {dateBig(r.date)}
                  </div>
                  <div className="mt-1.5 text-xs uppercase tracking-wide text-stone-400">
                    {dateSmall(r.date)}
                  </div>
                </div>

                {/* Article: a single blue link (the title) straight to WSJ */}
                <div>
                  <ArticleLink
                    href={r.articleUrl}
                    className="font-medium text-sky-700 transition hover:text-sky-900 hover:underline"
                  >
                    {r.title}
                  </ArticleLink>
                </div>

                {/* Handout: the study page */}
                <div className="sm:text-right">
                  <Link
                    href={`/reading/${r.date}`}
                    className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
                  >
                    Handout →
                  </Link>
                </div>

                {/* Quiz: the self-quiz page */}
                <div className="sm:text-right">
                  <Link
                    href={`/reading/${r.date}/quiz`}
                    className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
                  >
                    Quiz →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
