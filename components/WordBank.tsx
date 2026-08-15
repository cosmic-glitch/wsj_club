import { getAllReadings, type Track } from "@/lib/content";
import { audioSrcFor } from "@/lib/handout-audio";
import WordBankList, { type BankDay } from "@/components/WordBankList";
import WordQuiz from "@/components/WordQuiz";

/** "2026-07-08" → "Jul 8" (rendered uppercase in the date column). */
function dateTag(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// My Word Bank — each student's PERSONAL cumulative review list: the vocab
// words from every reading they've taken the AI quiz on (words only for now;
// concepts may join later), grouped BY READING with the newest first (the
// date is the sort column).
//
// Shared by both tracks (/words and /junior/words). SERVER component, same
// recipe as Handout/LandingIndex: it maps the track's readings into per-day
// word groups (resolving each ▶ pronunciation clip via audioSrcFor, which
// reads the filesystem at BUILD time — this is why the page stays static and
// the per-student filtering lives client-side in WordBankList instead: a
// dynamic render couldn't fs-check public/audio on Vercel) and hands them to
// the client list, which asks /api/quiz-dates which days the logged-in caller
// has actually quizzed on.
export default function WordBank({ track = "senior" }: { track?: Track }) {
  const junior = track === "junior";
  const base = junior ? "/junior" : "";

  // getAllReadings is already newest-first — the bank's display order.
  const days: BankDay[] = getAllReadings(track).map((r) => ({
    date: r.date,
    dateLabel: dateTag(r.date),
    articleTitle: r.title,
    href: `${base}/reading/${r.date}`,
    words: r.vocab.map((w) => ({
      term: w.word,
      pronunciation: w.pronunciation,
      meaning: w.meaning,
      audioSrc: audioSrcFor(r.date, w.word, track),
    })),
  }));

  return (
    <div>
      <header className="border-b-[5px] border-[#0a0a0a] pb-5">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[.18em] text-stone-500">
          {junior ? "Junior · Grades 5–7" : "Your review list"}
        </p>
        <h1 className="mt-2 font-display text-[clamp(30px,6.5vw,48px)] font-normal uppercase leading-[1.05] tracking-[.01em] text-[#0a0a0a]">
          My Word Bank
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          Every word from the readings you&apos;ve taken the AI quiz on, newest
          first.
        </p>
      </header>

      {days.length > 0 && <WordQuiz track={track} />}

      {days.length === 0 ? (
        <p className="mt-10 border-[3px] border-[#0a0a0a] p-8 text-center font-mono text-sm font-bold uppercase tracking-[.08em] text-[#0a0a0a]">
          {junior
            ? "No junior readings yet. The first one's words will appear here."
            : "No readings yet. The first one's words will appear here."}
        </p>
      ) : (
        <WordBankList days={days} track={track} />
      )}
    </div>
  );
}
