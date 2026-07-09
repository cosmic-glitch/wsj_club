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

// The handout in the landing page's brutalist language: Anton uppercase
// headings, mono uppercase labels, thick square black borders, the yellow
// #ffe600 accent — while the actual study text (definitions, quotes,
// examples) stays in the readable site sans.
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
      {/* Header — the article name as a mini-masthead. */}
      <header className="border-b-[5px] border-[#0a0a0a] pb-5">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[.18em] text-stone-500">
          Reading handout
        </p>
        <h1 className="mt-2 font-display text-[clamp(30px,6.5vw,48px)] font-normal uppercase leading-[1.05] tracking-[.01em] text-[#0a0a0a]">
          {reading.title}
        </h1>
      </header>

      {/* Vocabulary. On a vocab-only day (no concepts) we drop the step number
          so it doesn't show a lone "1" with no "2". */}
      <Section n={reading.concepts.length > 0 ? 1 : undefined} title="Words to know">
        <div className="space-y-5">
          {reading.vocab.map((w) => (
            <VocabCard key={w.word} word={w} />
          ))}
        </div>
      </Section>

      {/* Concepts — omitted entirely when the day has none. */}
      {reading.concepts.length > 0 && (
        <Section n={2} title="Concepts behind the story">
          <div className="space-y-5">
            {reading.concepts.map((c) => (
              <ConceptCard key={c.name} concept={c} />
            ))}
          </div>
        </Section>
      )}

      {/* Self-quiz CTA. The self-quiz lives here (off the index) — once
          you've read the handout, this is the natural place to test yourself. */}
      <div className="mt-14 border-[3px] border-[#0a0a0a] bg-[#ffe600] p-6 text-center">
        <p className="font-mono text-sm font-bold uppercase tracking-[.08em] text-[#0a0a0a]">
          Read the handout? Now test yourself.
        </p>
        <Link
          href={`/reading/${reading.date}/quiz`}
          className="mt-4 inline-block border-2 border-[#0a0a0a] bg-[#0a0a0a] px-6 py-3 font-mono text-sm font-bold uppercase tracking-[.1em] text-[#ffe600] no-underline transition hover:bg-white hover:text-[#0a0a0a]"
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
          <span className="flex h-8 w-8 items-center justify-center bg-[#0a0a0a] font-mono text-sm font-bold text-[#ffe600]">
            {n}
          </span>
        )}
        <h2 className="font-display text-[26px] font-normal uppercase leading-none tracking-[.01em] text-[#0a0a0a]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** Small uppercase mono label shown above a value. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-stone-500">
      {children}
    </p>
  );
}

/** The inline "What it means here" / "In general" lead-in on a paragraph. */
function InlineLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mr-1.5 font-mono text-[11px] font-bold uppercase tracking-[.08em] text-stone-500">
      {children}:
    </span>
  );
}

function VocabCard({ word }: { word: VocabWord }) {
  return (
    <div className="border-[3px] border-[#0a0a0a] bg-white p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <h3 className="font-display text-[22px] font-normal uppercase leading-none text-[#0a0a0a]">
          <span className="bg-[#ffe600] px-1.5 py-0.5">{word.word}</span>
        </h3>
        <span className="font-mono text-[11px] font-bold uppercase tracking-[.1em] text-stone-500">
          {word.partOfSpeech}
        </span>
      </div>

      <div className="mt-4">
        <Label>Quote from the article</Label>
        <blockquote className="mt-1.5 border-l-[5px] border-[#ffe600] pl-4 italic text-stone-700">
          “{word.articleQuote}”
        </blockquote>
      </div>

      <p className="mt-3 text-stone-800">
        <InlineLabel>What it means here</InlineLabel>
        {word.inContext}
      </p>

      <p className="mt-2 text-stone-800">
        <InlineLabel>In general</InlineLabel>
        {word.meaning}
      </p>

      <div className="mt-4">
        <Label>More examples</Label>
        <ul className="mt-1.5 list-[square] space-y-1 pl-5 text-sm italic text-stone-600 marker:text-[#0a0a0a]">
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
    <div className="border-[3px] border-[#0a0a0a] bg-white p-5">
      <h3 className="font-display text-[20px] font-normal uppercase leading-tight text-[#0a0a0a]">
        {concept.name}
      </h3>

      <div className="mt-4">
        <Label>Quote from the article</Label>
        <blockquote className="mt-1.5 border-l-[5px] border-[#ffe600] pl-4 italic text-stone-700">
          “{concept.articleQuote}”
        </blockquote>
      </div>

      <p className="mt-3 text-stone-800">
        <InlineLabel>What it means here</InlineLabel>
        {concept.inContext}
      </p>

      {concept.meaning.split(/\n\n+/).map((para, i) => (
        <p key={i} className="mt-2 text-stone-800">
          {i === 0 && <InlineLabel>In general</InlineLabel>}
          {para}
        </p>
      ))}
    </div>
  );
}
