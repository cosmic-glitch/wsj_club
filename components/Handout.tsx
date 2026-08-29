import Link from "next/link";
import { type Reading, type VocabWord, type Concept, type Track } from "@/lib/content";
import { audioSrcFor } from "@/lib/handout-audio";
import PronounceButton from "@/components/PronounceButton";
import { Rich, RichParagraphs } from "@/lib/rich-text";

// The handout body, shared by the senior (/reading/<date>) and junior
// (/junior/reading/<date>) tracks. In the landing page's brutalist language:
// Anton uppercase headings, mono uppercase labels, thick square black borders,
// the yellow #ffe600 accent — while the actual study text (definitions, quotes,
// examples) stays in the readable site sans.
//
// SERVER component (no "use client"): it resolves each term's pronunciation clip
// via audioSrcFor, which reads the filesystem at build/prerender time. Keep it a
// server component. The only track-dependent nav href — the "Take the self-quiz"
// CTA — is derived from `track` so a junior handout links to the junior quiz.
export default function Handout({
  reading,
  track = "senior",
}: {
  reading: Reading;
  track?: Track;
}) {
  const base = track === "junior" ? "/junior" : "";

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
            <VocabCard
              key={w.word}
              word={w}
              audioSrc={audioSrcFor(reading.date, w.word, track)}
            />
          ))}
        </div>
      </Section>

      {/* Concepts — omitted entirely when the day has none. */}
      {reading.concepts.length > 0 && (
        <Section n={2} title="Concepts behind the story">
          <div className="space-y-5">
            {reading.concepts.map((c) => (
              <ConceptCard
                key={c.name}
                concept={c}
                audioSrc={audioSrcFor(reading.date, c.name, track)}
              />
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
          href={`${base}/reading/${reading.date}/quiz`}
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

function VocabCard({
  word,
  audioSrc,
}: {
  word: VocabWord;
  audioSrc?: string;
}) {
  return (
    <div className="border-[3px] border-[#0a0a0a] bg-white p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <h3 className="font-display text-[22px] font-normal uppercase leading-none text-[#0a0a0a]">
          <span className="bg-[#ffe600] px-1.5 py-0.5">{word.word}</span>
        </h3>
        {word.pronunciation && (
          <span className="font-mono text-[13px] tracking-[.02em] text-stone-500">
            {word.pronunciation}
          </span>
        )}
        <PronounceButton
          text={word.word}
          label={word.word}
          audioSrc={audioSrc}
          className="self-center"
        />
      </div>

      <div className="mt-4">
        <Label>Quote from the article</Label>
        <blockquote className="mt-1.5 border-l-[5px] border-[#ffe600] pl-4 italic text-stone-700">
          “{word.articleQuote}”
        </blockquote>
      </div>

      {word.inContext ? (
        <>
          {/* Legacy days: a separate article gloss + general definition were
              authored as two segments — keep rendering both. */}
          <p className="mt-3 text-stone-800">
            <InlineLabel>What it means here</InlineLabel>
            <Rich text={word.inContext} />
          </p>
          <p className="mt-2 text-stone-800">
            <InlineLabel>In general</InlineLabel>
            <Rich text={word.meaning} />
          </p>
        </>
      ) : (
        <p className="mt-3 text-stone-800">
          <InlineLabel>Meaning</InlineLabel>
          <Rich text={word.meaning} />
        </p>
      )}

      <div className="mt-4">
        <Label>More examples</Label>
        <ul className="mt-1.5 list-[square] space-y-1 pl-5 text-sm italic text-stone-600 marker:text-[#0a0a0a]">
          {word.examples.map((ex, i) => (
            <li key={i}>
              <Rich text={ex} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ConceptCard({
  concept,
  audioSrc,
}: {
  concept: Concept;
  audioSrc?: string;
}) {
  return (
    <div className="border-[3px] border-[#0a0a0a] bg-white p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 className="font-display text-[20px] font-normal uppercase leading-tight text-[#0a0a0a]">
          {concept.name}
        </h3>
        <PronounceButton
          text={concept.name}
          label={concept.name}
          audioSrc={audioSrc}
        />
      </div>

      <div className="mt-4">
        <Label>Quote from the article</Label>
        <blockquote className="mt-1.5 border-l-[5px] border-[#ffe600] pl-4 italic text-stone-700">
          “{concept.articleQuote}”
        </blockquote>
      </div>

      {/* One clear explanation of the idea (Feynman-style, with a concrete
          example). Paragraphs split on blank lines; `**bold**`/`*italic*`
          render as real emphasis (see lib/rich-text) rather than as literal
          asterisks. */}
      <RichParagraphs
        text={concept.meaning}
        className="mt-2 text-stone-800"
        firstClassName="mt-4 text-stone-800"
      />

      {/* Optional diagram — a plain <img> of a hand-authored SVG under
          public/diagrams/. It sits AFTER the prose on purpose: read the
          mechanism, then check yourself against the picture. The SVG carries
          its own palette (no CSS reaches inside an <img>). */}
      {concept.diagram && (
        <figure className="mt-5 border-[3px] border-[#0a0a0a] bg-white p-3">
          <img
            src={concept.diagram.src}
            alt={concept.diagram.alt}
            className="mx-auto block h-auto w-full"
          />
          {concept.diagram.caption && (
            <figcaption className="mt-2.5 border-t-2 border-stone-200 pt-2 text-center font-sans text-sm text-stone-600">
              {concept.diagram.caption}
            </figcaption>
          )}
        </figure>
      )}

      {concept.link && (
        <a
          href={concept.link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block border-2 border-[#0a0a0a] bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-[.06em] text-[#0a0a0a] no-underline transition hover:bg-[#ffe600]"
        >
          {concept.link.label}
        </a>
      )}
    </div>
  );
}
