import Link from "next/link";
import ArticleLink from "@/components/ArticleLink";
import VoiceQuizStep from "@/components/VoiceQuizStep";
import { getAllReadings, dateBig } from "@/lib/content";

// One shared blue-link style so every link on the page matches.
const linkClass = "text-sky-700 transition hover:text-sky-900 hover:underline";

// Words for "Read the {first} article" on multi-article days.
const ORDINALS = ["first", "second", "third", "fourth", "fifth"];

// The "(PDF version)" link shown after an article link, when a PDF exists.
function PdfVersion({ href }: { href: string }) {
  return (
    <>
      {" "}
      (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        PDF version
      </a>
      )
    </>
  );
}

export default function Home() {
  const readings = getAllReadings();

  if (readings.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">
        No readings yet. The first one will appear here.
      </p>
    );
  }

  return (
    <ul className="space-y-6">
      {readings.map((r) => (
        <li
          key={r.date}
          className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm"
        >
          {/* The date */}
          <div className="font-serif text-2xl font-bold text-stone-900">
            {dateBig(r.date)}
          </div>

          {/* The article title — plain text, not a link */}
          <p className="mt-1.5 text-lg font-medium leading-snug text-stone-900">
            {r.title}
          </p>

          {/* The numbered steps. Single-article days read the one article in
              step 1; multi-article days get one "Read the Nth article" step per
              article, then the same handout / quiz steps. The last step pairs the
              1-1 quiz with the AI voice quiz as alternatives in one bullet; the
              voice half shows only for logged-in users on voiceQuiz days. */}
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-stone-700 marker:font-semibold marker:text-stone-400">
            {r.articles && r.articles.length > 0 ? (
              r.articles.map((a, i) => (
                <li key={a.articleUrl}>
                  Read the {ORDINALS[i] ?? `${i + 1}th`} article —{" "}
                  <ArticleLink href={a.articleUrl} className={linkClass}>
                    {a.title}
                  </ArticleLink>
                  {a.pdfUrl && <PdfVersion href={a.pdfUrl} />}
                </li>
              ))
            ) : (
              <li>
                Read the{" "}
                <ArticleLink href={r.articleUrl ?? "#"} className={linkClass}>
                  article
                </ArticleLink>
                {r.pdfUrl && <PdfVersion href={r.pdfUrl} />}
              </li>
            )}
            <li>
              Read the{" "}
              <Link href={`/reading/${r.date}`} className={linkClass}>
                handout
              </Link>
            </li>
            <li>
              Take the{" "}
              <Link href={`/reading/${r.date}/quiz`} className={linkClass}>
                self-quiz
              </Link>
            </li>
            <li>
              Schedule your{" "}
              <a
                href="https://calendly.com/cosmic-glitch/daily-quiz"
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                1-1 quiz
              </a>
              {/* The 1-1 quiz and the AI voice quiz are alternatives — you do
                  one or the other — so they share a single bullet. The voice
                  half is login-gated + voiceQuiz-only, appended inline. */}
              {r.voiceQuiz && <VoiceQuizStep date={r.date} title={r.title} />}
            </li>
          </ol>
        </li>
      ))}
    </ul>
  );
}
