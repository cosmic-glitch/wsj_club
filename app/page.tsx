import Link from "next/link";
import { getAllReadings, formatDate } from "@/lib/content";

export default function Home() {
  const readings = getAllReadings();

  return (
    <div>
      <section className="mb-10">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          The Daily Reading
        </h1>
        <p className="mt-3 max-w-2xl text-stone-600">
          Every day we read one Wall Street Journal article and break it down:
          the <strong>words</strong> worth knowing, the <strong>concepts</strong>{" "}
          behind the story, and a short <strong>quiz</strong> to check what stuck.
          Read the article first, then work through the handout.
        </p>
      </section>

      {readings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">
          No readings yet. The first one will appear here.
        </p>
      ) : (
        <ol className="space-y-4">
          {readings.map((r) => (
            <li key={r.date}>
              <Link
                href={`/reading/${r.date}`}
                className="block rounded-xl border border-stone-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-xs font-medium uppercase tracking-wide text-stone-400">
                    {formatDate(r.date)}
                  </span>
                  {r.readingTimeMinutes ? (
                    <span className="shrink-0 text-xs text-stone-400">
                      {r.readingTimeMinutes} min read
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-2 font-serif text-xl font-bold text-stone-900">
                  {r.title}
                </h2>
                <p className="mt-2 line-clamp-2 text-sm text-stone-600">
                  {r.summary}
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <Tag>{r.vocab.length} words</Tag>
                  <Tag>{r.concepts.length} concepts</Tag>
                  <Tag>{r.quiz.length}-question quiz</Tag>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-stone-100 px-3 py-1 font-medium text-stone-600">
      {children}
    </span>
  );
}
