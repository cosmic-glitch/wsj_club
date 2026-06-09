import fs from "fs";
import path from "path";

/**
 * One vocabulary word the kids likely don't know yet.
 * Presented article-first: how it's used in the article, what it means there,
 * then the broader meaning, then two more examples.
 */
export type VocabWord = {
  word: string;
  partOfSpeech: string; // e.g. "noun", "verb", "adjective"
  articleQuote: string; // the phrase/sentence from the article where the word appears
  inContext: string; // what the word means right there, in the article's context
  meaning: string; // the broader, general definition
  examples: string[]; // two more example sentences a teenager would relate to
};

/**
 * A richer idea that needs background knowledge, not just a definition.
 * Presented article-first: the quoted article segment, what it means there,
 * then the broader meaning.
 */
export type Concept = {
  name: string; // e.g. "Private credit", "Hyperscalers"
  articleQuote: string; // the segment of the article where the idea appears
  inContext: string; // what it means in that context
  meaning: string; // the broader, general meaning (how it works)
};

/** A single multiple-choice quiz question. */
export type QuizQuestion = {
  question: string;
  options: string[];
  answerIndex: number; // index into options of the correct answer
  explanation: string; // shown after answering
};

/** A full day's reading handout. The skill writes one JSON file per day. */
export type Reading = {
  date: string; // "YYYY-MM-DD"
  title: string; // a clear, descriptive title (need not match WSJ's headline)
  articleUrl: string; // link to the original WSJ article (the "Web" link)
  pdfUrl?: string; // served PDF of the article, e.g. "/pdfs/2026-06-09.pdf" (the "PDF" link)
  source?: string; // e.g. "The Wall Street Journal"
  vocab: VocabWord[];
  concepts: Concept[];
  quiz: QuizQuestion[];
};

const CONTENT_DIR = path.join(process.cwd(), "content");

/** Load every reading, newest first. */
export function getAllReadings(): Reading[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".json"));
  const readings = files.map((f) => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, f), "utf8");
    return JSON.parse(raw) as Reading;
  });
  return readings.sort((a, b) => b.date.localeCompare(a.date));
}

/** Load a single reading by its date string, or undefined if missing. */
export function getReading(date: string): Reading | undefined {
  return getAllReadings().find((r) => r.date === date);
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
