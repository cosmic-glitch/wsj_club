import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAllReadings,
  getReading,
  formatDate,
  type VocabWord,
  type Concept,
} from "@/lib/content";
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
  if (!reading) return { title: "Reading not found" };
  return {
    title: `${reading.title} · WSJ Reading Club`,
    description: reading.summary,
  };
}

export default async function ReadingPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const reading = getReading(date);
  if (!reading) notFound();

  return (
    <article>
      <Link
        href="/"
        className="text-sm text-stone-500 transition hover:text-stone-900"
      >
        ← All readings
      </Link>

      {/* Header */}
      <header className="mt-4 border-b border-stone-200 pb-8">
        <p className="font-serif text-2xl font-bold text-amber-800 sm:text-3xl">
          {formatDate(reading.date)}
        </p>
        <h1 className="mt-3 font-serif text-3xl font-bold leading-tight tracking-tight text-stone-900 sm:text-4xl">
          {reading.title}
        </h1>
        {reading.bigIdea ? (
          <p className="mt-4 text-lg text-stone-700">{reading.bigIdea}</p>
        ) : null}
        <p className="mt-4 text-stone-600">{reading.summary}</p>
        <a
          href={reading.articleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700"
        >
          Read the article in {reading.source ?? "The Wall Street Journal"} →
        </a>
      </header>

      {/* Vocabulary */}
      <Section
        n={1}
        title="Words to know"
        blurb="Words from this article worth adding to your vocabulary. Try to use each one in a sentence today."
      >
        <div className="space-y-4">
          {reading.vocab.map((w) => (
            <VocabCard key={w.word} word={w} />
          ))}
        </div>
      </Section>

      {/* Concepts */}
      <Section
        n={2}
        title="Concepts behind the story"
        blurb="The bigger ideas you need to really understand what the article is saying — not just definitions, but how they work."
      >
        <div className="space-y-4">
          {reading.concepts.map((c) => (
            <ConceptCard key={c.name} concept={c} />
          ))}
        </div>
      </Section>

      {/* Quiz */}
      <Section
        n={3}
        title="Quiz yourself"
        blurb="Answer all the questions, then check your score. No peeking at the article!"
      >
        <Quiz questions={reading.quiz} />
      </Section>
    </article>
  );
}

function Section({
  n,
  title,
  blurb,
  children,
}: {
  n: number;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="mb-5">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-900 text-sm font-semibold text-white">
            {n}
          </span>
          <h2 className="font-serif text-2xl font-bold text-stone-900">
            {title}
          </h2>
        </div>
        <p className="mt-2 text-sm text-stone-500">{blurb}</p>
      </div>
      {children}
    </section>
  );
}

function VocabCard({ word }: { word: VocabWord }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-serif text-xl font-bold text-stone-900">
          {word.word}
        </h3>
        <span className="text-sm italic text-stone-400">
          {word.partOfSpeech}
        </span>
      </div>
      <p className="mt-2 text-stone-700">{word.definition}</p>
      <p className="mt-3 text-sm text-stone-600">
        <span className="font-semibold text-stone-500">Example: </span>
        <span className="italic">{word.example}</span>
      </p>
      {word.inContext ? (
        <p className="mt-3 rounded-lg bg-stone-50 px-4 py-2 text-sm text-stone-600">
          <span className="font-semibold text-stone-500">In the article: </span>
          {word.inContext}
        </p>
      ) : null}
    </div>
  );
}

function ConceptCard({ concept }: { concept: Concept }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h3 className="font-serif text-xl font-bold text-stone-900">
        {concept.name}
      </h3>
      <p className="mt-2 text-stone-700">{concept.explanation}</p>
      <p className="mt-3 border-l-2 border-amber-300 pl-4 text-sm text-stone-600">
        <span className="font-semibold text-stone-500">Why it matters: </span>
        {concept.whyItMatters}
      </p>
    </div>
  );
}
