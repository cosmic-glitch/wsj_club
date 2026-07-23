import fs from "fs";
import path from "path";

/**
 * A reading track. `senior` (US grades 8–10) is the original club and keeps
 * every date-keyed path exactly as it was; `junior` (US grades 5–7) is a second,
 * occasional track that lives under a `junior/` path segment everywhere (content
 * files, PDFs, audio, article text, Blob session keys, and the /junior routes).
 * A day is identified by (track, date) — a junior article usually lands on a date
 * that already has a senior one, so `date` alone is no longer a unique key.
 */
export type Track = "senior" | "junior";

/** The content directory for a track: senior = content/, junior = content/junior/. */
function contentDirFor(track: Track): string {
  return track === "junior" ? path.join(CONTENT_DIR, "junior") : CONTENT_DIR;
}

/**
 * One vocabulary word the kids likely don't know yet.
 * Presented article-first: how it's used in the article, what it means there,
 * then the broader meaning, then two more examples.
 */
export type VocabWord = {
  word: string;
  partOfSpeech: string; // e.g. "noun", "verb", "adjective" — NOT shown on the handout anymore (the pronunciation respelling took its place), but still fed to the voice-quiz tutor (lib/quiz-prompt.ts)
  pronunciation?: string; // plain-English US respelling shown on the card in place of the part of speech — hyphen-separated syllables, primary stress in CAPS (e.g. "rih-PUG-nunt", "yoo-BIK-wih-tus"). NOT IPA. The ▶ button plays the real audio; this is the at-a-glance text guide
  articleQuote: string; // the phrase/sentence from the article where the word appears
  inContext: string; // what the word means right there, in the article's context
  meaning: string; // the broader, general definition
  examples: string[]; // two more example sentences a teenager would relate to
};

/**
 * A richer idea that needs background knowledge, not just a definition.
 * Anchored by a short article quote, then explained ONCE — a single, clear,
 * Feynman-style explanation grounded with at least one concrete example.
 * (Unlike vocab, a concept is NOT split into "what it means here" vs "in
 * general" — it just broadly explains the idea. `inContext` is legacy/optional
 * and no longer rendered.)
 */
export type Concept = {
  name: string; // e.g. "Private credit", "Hyperscalers"
  articleQuote: string; // the segment of the article where the idea appears
  inContext?: string; // legacy: the article-specific gloss — kept on older entries, no longer rendered
  meaning: string; // the single, intuitive, concrete explanation of the idea (with ≥1 concrete example)
  link?: { url: string; label: string }; // optional illustrative external link (e.g. a live prediction market), shown as a button under the meaning
};

/** A single multiple-choice quiz question. */
export type QuizQuestion = {
  question: string;
  options: string[];
  answerIndex: number; // index into options of the correct answer
  explanation: string; // shown after answering
};

/**
 * One source article. Most days have a single article (use the top-level
 * `articleUrl`/`pdfUrl` on `Reading`). Some days bundle two or more short
 * articles into one handout — those go in `Reading.articles`, each with its
 * own headline and links.
 */
export type Source = {
  title: string; // the article's own headline (shown as the link text on the index)
  articleUrl: string; // link to the original WSJ article (the "Web" link)
  pdfUrl?: string; // served PDF of the article, e.g. "/pdfs/2026-06-14-1.pdf"
  articlePageUrl?: string; // served self-contained responsive HTML article page, e.g. "/articles/2026-07-22-1.html" — when set, the index shows ONE "Article N" button instead of Web/PDF for this source
};

/** A full day's reading handout. The skill writes one JSON file per day. */
export type Reading = {
  date: string; // "YYYY-MM-DD"
  title: string; // a clear, descriptive title (need not match WSJ's headline)
  articleUrl?: string; // single-article days: the WSJ article link (the "Web" link on legacy days; kept as source-of-record metadata on article-page days)
  pdfUrl?: string; // single-article days: served PDF, e.g. "/pdfs/2026-06-09.pdf" (legacy days; unused when articlePageUrl is set)
  articlePageUrl?: string; // single-article days: served self-contained responsive HTML article page, e.g. "/articles/2026-07-22.html" — when set, the index row shows ONE "Article" button in place of the Web + PDF pair. Only for paywalled sources: an OPEN web article omits it (and pdfUrl), and the row's "Article" button then links straight to articleUrl. Legacy days with a pdfUrl keep Web/PDF
  articles?: Source[]; // multi-article days: when set, the entry bundles these (top-level articleUrl/pdfUrl unused)
  voiceQuiz?: boolean; // when true, the home-page row's action bar shows a "Voice quiz" launcher for this day (login-gated; the skill sets it)
  clubPick?: boolean; // when true, the day's article was chosen by the club's vote (see the daily vote in CLAUDE.md) — the index row shows a small CLUB PICK chip
  source?: string; // e.g. "The Wall Street Journal"
  vocab: VocabWord[];
  concepts: Concept[];
  quiz: QuizQuestion[];
};

const CONTENT_DIR = path.join(process.cwd(), "content");

/**
 * The single site-wide announcement banner shown at the top of the home page —
 * the day's announcements (new features, reading guidance for today's article).
 * Edited in place in content/announcement.json; not per-day data.
 */
export type Announcement = {
  messages: string[]; // one or more short announcement lines; empty → no banner
};

const ANNOUNCEMENT_FILE = path.join(CONTENT_DIR, "announcement.json");

/** Load the current announcement lines (empty array → the banner is omitted). */
export function getAnnouncements(): string[] {
  if (!fs.existsSync(ANNOUNCEMENT_FILE)) return [];
  const raw = JSON.parse(
    fs.readFileSync(ANNOUNCEMENT_FILE, "utf8"),
  ) as Announcement;
  return Array.isArray(raw.messages) ? raw.messages.filter(Boolean) : [];
}

/**
 * Load every reading in a track, newest first. Senior reads `content/`, junior
 * reads `content/junior/`. The default keeps every existing caller (senior)
 * unchanged. The junior dir may not exist until the first junior reading is
 * published — the existsSync guard returns [] then (this is why /junior needs an
 * empty state).
 */
export function getAllReadings(track: Track = "senior"): Reading[] {
  const dir = contentDirFor(track);
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    // Only date-named files are readings — announcement.json (and the junior/
    // subdirectory) live under content/ too, and neither matches this pattern.
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const readings = files.map((f) => {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    return JSON.parse(raw) as Reading;
  });
  return readings.sort((a, b) => b.date.localeCompare(a.date));
}

/** Load a single reading by its date string within a track, or undefined. */
export function getReading(date: string, track: Track = "senior"): Reading | undefined {
  return getAllReadings(track).find((r) => r.date === date);
}

/** Format "2026-06-09" as "Tuesday, June 9, 2026". */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The big, prominent part of a date, e.g. "June 9". */
export function dateBig(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The supporting part of a date — the weekday, e.g. "Tuesday". */
export function dateSmall(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}
