import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works · Daily Reading Club",
  description:
    "One hand-picked article a day, read actively: study the handout, then explain the article to an AI tutor that keeps you honest.",
};

// The new-joiner guide: why the club exists (active reading, out loud, kept
// honest by the AI), then the daily loop as three numbered step cards (each
// with a slot for a short screen-recording loop), the smaller things worth
// knowing, and a CTA back to today's reading. Static, track-agnostic — the
// junior track works the same way, so one page serves both. Per the site
// rule, mono is the label layer only — every sentence here is in the sans.

/** A step's screen-recording loop: recorded against the real site (960x540),
 *  muted + looping like a GIF but a fraction of the size. */
function Clip({ src, label }: { src: string; label: string }) {
  return (
    <video
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={label}
      className="mt-5 aspect-video w-full border-2 border-[#0a0a0a]"
    />
  );
}

/** One numbered step of the daily loop. Children are the card's body — one or
 *  more paragraphs / blocks in the readable sans. */
function Step({
  n,
  title,
  clip,
  children,
}: {
  n: number;
  title: string;
  clip: { src: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <li className="border-[3px] border-[#0a0a0a] p-5 shadow-[6px_6px_0_#0a0a0a] min-[500px]:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-[#0a0a0a] font-mono text-base font-bold text-[#ffe600]">
          {n}
        </span>
        <h2 className="font-display text-[24px] font-normal uppercase leading-none tracking-[.01em] text-[#0a0a0a] min-[500px]:text-[28px]">
          {title}
        </h2>
      </div>
      <div className="mt-3 space-y-3 font-sans text-[15px] leading-relaxed text-stone-700">
        {children}
      </div>
      <Clip src={clip.src} label={clip.label} />
    </li>
  );
}

/** Small uppercase mono label above a sub-part of a step (the handout's
 *  label-over-value recipe). */
function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-stone-500">
      {children}
    </p>
  );
}

/** One entry in the "also good to know" grid. */
function Extra({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-2 border-[#0a0a0a] p-4">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[.14em] text-[#0a0a0a]">
        {title}
      </p>
      <p className="mt-1.5 font-sans text-[13.5px] leading-relaxed text-stone-600">
        {children}
      </p>
    </div>
  );
}

export default function GuidePage() {
  return (
    <article>
      {/* Header — the handout pages' mini-masthead recipe, then the pitch:
          what the club is for, and the active-reading idea that drives it. */}
      <header className="border-b-[5px] border-[#0a0a0a] pb-6">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[.18em] text-stone-500">
          New here?
        </p>
        <h1 className="mt-2 font-display text-[clamp(38px,9vw,64px)] font-normal uppercase leading-[1.02] tracking-[.01em] text-[#0a0a0a]">
          How it{" "}
          <span className="text-transparent [-webkit-text-stroke:2px_#0a0a0a]">
            works
          </span>
        </h1>
        <div className="mt-4 max-w-2xl space-y-3 font-sans text-[15px] leading-relaxed text-stone-700">
          <p>
            Here is a simple test for whether you actually know something:
            explain it, in your own words, without looking. The Nobel
            Prize-winning physicist Richard Feynman made this his standard:
            if he could not explain an idea simply, he took it to mean he did
            not understand it. Most reading fails the test. You finish an
            article, and a day later you can&rsquo;t say three sentences
            about it.
          </p>
          <p>
            This club is built on Feynman&rsquo;s insight. Read a hand-picked
            article every day, then explain it to an AI tutor for 5&ndash;10
            minutes straight, recalling all the important details. Then the AI
            quizzes you on the highlighted vocabulary and concepts from the
            article, to solidify your understanding. Ten minutes of explaining
            cannot be faked. Do it every day and your general knowledge, your
            vocabulary, and your SAT verbal score all build quietly in the
            background.
          </p>
        </div>
      </header>

      {/* The daily loop. */}
      <ol className="mt-10 space-y-8">
        <Step
          n={1}
          title="Read the article"
          clip={{
            src: "/guide/clip-article.mp4",
            label: "Tapping a highlighted word on the article page opens its definition",
          }}
        >
          <p>
            Start from the day&rsquo;s row on the home page and hit{" "}
            <strong>Article</strong>. Read it like you&rsquo;ll have to explain
            it, because you will. Tap any{" "}
            <span className="underline decoration-dotted decoration-2 underline-offset-2">
              dotted-underlined
            </span>{" "}
            word for an instant definition, with audio so you hear how
            it&rsquo;s said.
          </p>
        </Step>

        <Step
          n={2}
          title="Study the handout"
          clip={{
            src: "/guide/clip-handout.mp4",
            label: "Scrolling through a day's handout: words to know, then concepts",
          }}
        >
          <p>
            The <strong>Handout</strong>{" "}button opens the day&rsquo;s study
            sheet: the words to know and the concepts behind the story. This is
            the part to actually learn. The AI quiz draws straight from it.
          </p>
        </Step>

        <Step
          n={3}
          title="Do the AI voice quiz"
          clip={{
            src: "/guide/clip-quiz.mp4",
            label: "One voice-quiz turn: the tutor asks, you record an answer, the tutor follows up",
          }}
        >
          <p>
            An AI tutor interviews you about the article, out loud. Press{" "}
            <strong>Start</strong> to answer, <strong>Stop</strong>{" "}when
            you&rsquo;re done. Here&rsquo;s how a session goes:
          </p>
          <div className="space-y-4 border-l-[3px] border-[#0a0a0a] pl-4">
            <div>
              <SubLabel>First, always</SubLabel>
              <p className="mt-1">
                <strong>Explain the article.</strong> The expectation: talk for{" "}
                <strong>5&ndash;10 minutes, non-stop</strong>, covering
                everything you learned. Scribbling a few notes while you read
                helps, but keep them light. Excessive note-taking hampers your
                thinking
                and turns the explanation rote, so be careful on that front
                too.
              </p>
            </div>
            <div>
              <SubLabel>Then</SubLabel>
              <p className="mt-1">
                The AI asks about the <strong>vocabulary words</strong> and
                the <strong>concepts</strong> from the handout.
              </p>
            </div>
            <div>
              <SubLabel>At the end</SubLabel>
              <p className="mt-1">
                You get a <strong>score out of 10</strong> and the{" "}
                <strong>full recording</strong> of your session, so you can
                track your progress over time.
              </p>
            </div>
          </div>
          <p>
            Interrupted mid-quiz? It saves your place. Just resume later.
          </p>
        </Step>
      </ol>

      {/* The smaller things. */}
      <section className="mt-14">
        <h2 className="font-display text-[26px] font-normal uppercase leading-none tracking-[.01em] text-[#0a0a0a]">
          Also good to know
        </h2>
        <div className="mt-5 grid grid-cols-1 gap-3 min-[500px]:grid-cols-2">
          <Extra title="Streak">
            Finish the voice quiz on the day&rsquo;s article and your streak
            grows. It shows right on the home page when you&rsquo;re logged in.
          </Extra>
          <Extra title="Word bank">
            Every word from every handout you&rsquo;ve quizzed on, collected in
            one place. Yours builds automatically.
          </Extra>
          <Extra title="Vote days">
            Some days the club picks the article: a ballot appears at the top
            of the home page. One member, one vote.
          </Extra>
          <Extra title="Suggest a read">
            Found a great article? Send it with <strong>Suggest</strong> in the
            top bar. Every suggestion gets read and answered.
          </Extra>
          <Extra title="Junior track">
            Grades 5–7 have their own readings at{" "}
            <Link href="/junior" className="font-bold underline">
              /junior
            </Link>
            . Same loop, calibrated younger.
          </Extra>
          <Extra title="For parents">
            The <strong>Reports</strong> page shows every attempt and report
            card from your kids, including quizzes still in progress.
          </Extra>
        </div>
      </section>

      {/* CTA back into the loop. */}
      <div className="mt-14 border-[3px] border-[#0a0a0a] bg-[#ffe600] p-6 text-center">
        <p className="font-sans text-[15px] font-bold text-[#0a0a0a]">
          That&rsquo;s the whole loop. Read actively, explain it out loud,
          repeat tomorrow.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block border-2 border-[#0a0a0a] bg-[#0a0a0a] px-6 py-3 font-mono text-sm font-bold uppercase tracking-[.1em] text-[#ffe600] no-underline transition hover:bg-white hover:text-[#0a0a0a]"
        >
          Go to today&rsquo;s reading →
        </Link>
      </div>
    </article>
  );
}
