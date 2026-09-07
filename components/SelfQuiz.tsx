import { type Reading, type Track } from "@/lib/content";
import Quiz from "@/components/Quiz";
import PageBeacon from "@/components/PageBeacon";

// The self-quiz page body, shared by the senior (/reading/<date>/quiz) and
// junior (/junior/reading/<date>/quiz) tracks. A black SELF-QUIZ chip + Anton
// title matching the handout, then the interactive Quiz. No track-dependent nav
// hrefs live inside it; `track` only labels the activity beacon.
export default function SelfQuiz({
  reading,
  track = "senior",
}: {
  reading: Reading;
  track?: Track;
}) {
  return (
    <article>
      {/* Activity beacon (analytics) — one selfquiz_view per open. */}
      <PageBeacon kind="selfquiz_view" track={track} date={reading.date} />
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
