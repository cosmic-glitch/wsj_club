import Link from "next/link";
import ArticleLink from "@/components/ArticleLink";
import { getAllReadings, dateBig } from "@/lib/content";

export default function Home() {
  const readings = getAllReadings();

  return (
    <div>
      <div className="mb-8">
        <ol className="list-decimal space-y-1 pl-5 text-stone-700 marker:font-semibold marker:text-stone-400">
          <li>Read today&rsquo;s article</li>
          <li>Read the handout</li>
          <li>Take the quiz</li>
          <li>Call Anurag</li>
        </ol>
      </div>

      {readings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">
          No readings yet. The first one will appear here.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <ul className="divide-y divide-stone-200">
            {readings.map((r) => (
              <li
                key={r.date}
                className="grid grid-cols-1 gap-2 px-6 py-5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6"
              >
                {/* Date — just the date, no weekday */}
                <div className="font-serif text-xl font-bold text-stone-900">
                  {dateBig(r.date)}
                </div>

                {/* Article: a label, then a blue link straight to WSJ */}
                <div>
                  <span className="font-semibold text-stone-500">Article: </span>
                  <ArticleLink
                    href={r.articleUrl}
                    className="font-medium text-sky-700 transition hover:text-sky-900 hover:underline"
                  >
                    {r.title}
                  </ArticleLink>
                </div>

                {/* Handout and Quiz: plain blue links, same as the rest */}
                <div className="flex gap-4 sm:justify-end">
                  <Link
                    href={`/reading/${r.date}`}
                    className="text-sky-700 transition hover:text-sky-900 hover:underline"
                  >
                    Handout
                  </Link>
                  <Link
                    href={`/reading/${r.date}/quiz`}
                    className="text-sky-700 transition hover:text-sky-900 hover:underline"
                  >
                    Quiz
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
