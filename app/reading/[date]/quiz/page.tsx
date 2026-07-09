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
      {/* Header — the article name as a mini-masthead, matching the handout. */}
      <header className="border-b-[5px] border-[#0a0a0a] pb-5">
        <p>
          <span className="inline-block bg-[#0a0a0a] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#ffe600]">
            Self-quiz
          </span>
        </p>
        <h1 className="mt-3 font-display text-[clamp(30px,6.5vw,48px)] font-normal uppercase leading-[1.05] tracking-[.01em] text-[#0a0a0a]">
          {reading.title}
        </h1>
      </header>

      <div className="mt-8">
        <Quiz questions={reading.quiz} />
      </div>
    </article>
  );
}
