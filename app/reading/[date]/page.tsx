import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAllReadings,
  getReading,
  type VocabWord,
  type Concept,
} from "@/lib/content";

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
    description: `Words and concepts from "${reading.title}".`,
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
      {/* Header — just the article name */}
      <header>
        <h1 className="font-serif text-3xl font-bold leading-tight tracking-tight text-stone-900 sm:text-4xl">
          {reading.title}
        </h1>
      </header>

      {/* Vocabulary. On a vocab-only day (no concepts) we drop the step number
          so it doesn't show a lone "1" with no "2". */}
      <Section n={reading.concepts.length > 0 ? 1 : undefined} title="Words to know">
        <div className="space-y-4">
          {reading.vocab.map((w) => (
            <VocabCard key={w.word} word={w} />
          ))}
        </div>
      </Section>

      {/* Concepts — omitted entirely when the day has none. */}
      {reading.concepts.length > 0 && (
        <Section n={2} title="Concepts behind the story">
          <div className="space-y-4">
            {reading.concepts.map((c) => (
              <ConceptCard key={c.name} concept={c} />
            ))}
          </div>
        </Section>
      )}

      {/* Self-quiz CTA. The self-quiz lives here now (off the index) — once
          you've read the handout, this is the natural place to test yourself. */}
      <div className="mt-12 rounded-xl border border-stone-200 bg-stone-50 p-5 text-center">
        <p className="text-stone-700">Read the handout? Now test yourself.</p>
        <Link
          href={`/reading/${reading.date}/quiz`}
          className="mt-3 inline-block rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700"
        >
          Take the self-quiz →
        </Link>
      </div>
    </article>
  );
}

function Section({
  n,
  title,
  children,
}: {
  n?: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="mb-5 flex items-center gap-3">
        {n !== undefined && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-900 text-sm font-semibold text-white">
            {n}
          </span>
        )}
        <h2 className="font-serif text-2xl font-bold text-stone-900">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** Small uppercase label shown above a value. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
      {children}
    </p>
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

      <div className="mt-3">
        <Label>Quote from the article</Label>
        <blockquote className="mt-1 border-l-2 border-stone-300 pl-4 italic text-stone-600">
          “{word.articleQuote}”
        </blockquote>
      </div>

      <p className="mt-3 text-stone-700">
        <span className="font-semibold text-stone-500">
          What it means here:{" "}
        </span>
        {word.inContext}
      </p>

      <p className="mt-2 text-stone-700">
        <span className="font-semibold text-stone-500">In general: </span>
        {word.meaning}
      </p>

      <div className="mt-3">
        <Label>More examples</Label>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm italic text-stone-600">
          {word.examples.map((ex, i) => (
            <li key={i}>{ex}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ConceptCard({ concept }: { concept: Concept }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h3 className="font-serif text-xl font-bold text-stone-900">
        {concept.name}
      </h3>

      <div className="mt-3">
        <Label>Quote from the article</Label>
        <blockquote className="mt-1 border-l-2 border-amber-300 pl-4 italic text-stone-600">
          “{concept.articleQuote}”
        </blockquote>
      </div>

      <p className="mt-3 text-stone-700">
        <span className="font-semibold text-stone-500">
          What it means here:{" "}
        </span>
        {concept.inContext}
      </p>

      <p className="mt-2 text-stone-700">
        <span className="font-semibold text-stone-500">In general: </span>
        {concept.meaning}
      </p>
    </div>
  );
}
