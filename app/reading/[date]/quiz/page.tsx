import { notFound } from "next/navigation";
import { getAllReadings, getReading } from "@/lib/content";
import Quiz from "@/components/Quiz";

export function generateStaticParams() {
  return getAllReadings().map((r) => ({ date: r.date }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const reading = getReading(date);
  if (!reading) return { title: "Quiz not found" };
  return {
    title: `Quiz · ${reading.title} · WSJ Reading Club`,
    description: `Self-quiz for "${reading.title}".`,
  };
}

export default async function QuizPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const reading = getReading(date);
  if (!reading) notFound();

  return (
    <article>
      {/* Header — just the article name */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
          Self-quiz
        </p>
        <h1 className="mt-1 font-serif text-3xl font-bold leading-tight tracking-tight text-stone-900 sm:text-4xl">
          {reading.title}
        </h1>
      </header>

      <div className="mt-8">
        <Quiz questions={reading.quiz} />
      </div>
    </article>
  );
}
