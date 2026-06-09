import fs from "fs";
import path from "path";

/** One vocabulary word the kids likely don't know yet. */
export type VocabWord = {
  word: string;
  partOfSpeech: string; // e.g. "noun", "verb", "adjective"
  definition: string; // plain, kid-friendly definition
  example: string; // an example sentence they'd relate to
  inContext?: string; // (optional) how the idea showed up in the article, paraphrased
};

/** A richer idea that needs background knowledge, not just a definition. */
export type Concept = {
  name: string; // e.g. "Private credit", "Hyperscalers"
  explanation: string; // the deeper conceptual layer
  whyItMatters: string; // how it connects to the article / the wider world
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
  articleUrl: string; // link to the original WSJ article
  source?: string; // e.g. "The Wall Street Journal"
  summary: string; // 2-4 sentence original overview (NOT a copy of the article)
  bigIdea?: string; // one-line "why this matters"
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

/** The supporting part of a date, e.g. "Tuesday · 2026". */
export function dateSmall(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
  return `${weekday} · ${y}`;
}
