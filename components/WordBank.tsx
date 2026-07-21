import { getAllReadings, type Track } from "@/lib/content";
import { audioSrcFor } from "@/lib/handout-audio";
import WordBankList, { type BankWord } from "@/components/WordBankList";

/** "2026-07-08" → "Jul 8" (rendered uppercase in the chip). */
function dateTag(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// The Word Bank — each student's PERSONAL, searchable review list: the vocab
// words from every reading they've taken the AI quiz on (not the whole
// catalog — most students haven't covered most days, and words from a session
// they never did don't belong in their review). Words only for now; concepts
// may join later.
//
// Shared by both tracks (/words and /junior/words). SERVER component, same
// recipe as Handout/LandingIndex: it flattens the track's readings into word
// entries — resolving each ▶ pronunciation clip via audioSrcFor, which reads
// the filesystem at BUILD time (this is why the page stays static and the
// per-student filtering lives client-side in WordBankList instead: a dynamic
// render couldn't fs-check public/audio on Vercel) — and hands them to the
// client list, which asks /api/quiz-dates which days the logged-in caller has
// actually quizzed on.
export default function WordBank({ track = "senior" }: { track?: Track }) {
  const junior = track === "junior";
  const base = junior ? "/junior" : "";
  const readings = getAllReadings(track);

  const words: BankWord[] = [];
  for (const r of readings) {
    for (const w of r.vocab) {
      words.push({
        term: w.word,
        pronunciation: w.pronunciation,
        meaning: w.meaning,
        date: r.date,
        dateLabel: dateTag(r.date),
        articleTitle: r.title,
        audioSrc: audioSrcFor(r.date, w.word, track),
        href: `${base}/reading/${r.date}`,
      });
    }
  }
  // Alphabetical — it's a glossary; the date chip carries the chronology.
  words.sort(
    (a, b) => a.term.localeCompare(b.term) || a.date.localeCompare(b.date),
  );

  return (
    <div>
      <header className="border-b-[5px] border-[#0a0a0a] pb-5">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[.18em] text-stone-500">
          {junior ? "Junior · Grades 5–7" : "Your review list"}
        </p>
        <h1 className="mt-2 font-display text-[clamp(30px,6.5vw,48px)] font-normal uppercase leading-[1.05] tracking-[.01em] text-[#0a0a0a]">
          Word bank
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          Every word from the readings you&apos;ve taken the AI quiz on, in one
          place to review. Tap ▶ to hear a word, or its date to revisit that
          day&apos;s handout.
        </p>
      </header>

      {words.length === 0 ? (
        <p className="mt-10 border-[3px] border-[#0a0a0a] p-8 text-center font-mono text-sm font-bold uppercase tracking-[.08em] text-[#0a0a0a]">
          {junior
            ? "No junior readings yet. The first one's words will appear here."
            : "No readings yet. The first one's words will appear here."}
        </p>
      ) : (
        <WordBankList words={words} track={track} />
      )}
    </div>
  );
}
