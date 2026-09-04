#!/usr/bin/env node
// Mechanical checks on a day's content JSON — the part of the wsj-reading
// sign-off that a script can do. Used by the autonomous auto-publish run as its
// quality gate (there's no human reviewer there) and handy interactively too.
//
//   node scripts/check-content.mjs <YYYY-MM-DD> [--track=junior] [--no-audio]
//
// Checks: JSON parses and matches the filename date; articlePageUrl points at
// an existing captured page; voiceQuiz is on; vocab = exactly 3 words with
// pronunciation + part of speech + exactly 2 examples; 0–3 concepts; no legacy
// inContext; EVERY articleQuote (vocab + concepts) occurs VERBATIM in the day's
// captured article text (article-text/<date>.txt — quotes/dashes/whitespace
// normalized; this is the cross-article-contamination guard); each vocab quote
// actually contains its word; quiz = 5 questions × 4 options with a valid
// answerIndex; rich-text links are http(s); and — unless --no-audio — every
// vocab word + concept name has its pronunciation clip and quiz-intro.mp3
// exists (the handout hides the ▶ button for a missing clip, never errors).
// Exits 1 on any error; warnings don't fail.
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const argv = process.argv.slice(2);
const date = argv.find((a) => !a.startsWith("--"));
const trackFlag = argv.find((a) => a.startsWith("--track="));
const track = trackFlag ? trackFlag.slice("--track=".length) : "senior";
const checkAudio = !argv.includes("--no-audio");

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("usage: node scripts/check-content.mjs <YYYY-MM-DD> [--track=junior] [--no-audio]");
  process.exit(1);
}
const sub = track === "junior" ? "junior/" : "";
const contentFile = path.join(ROOT, "content", sub, `${date}.json`);
const textFile = path.join(ROOT, "article-text", sub, `${date}.txt`);
const audioDir = path.join(ROOT, "public", "audio", sub, date);

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// Same slug as lib/handout-audio.ts + scripts/gen-pronunciation.mjs.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const norm = (s) =>
  String(s)
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

let day;
try {
  day = JSON.parse(fs.readFileSync(contentFile, "utf8"));
} catch (e) {
  console.error(`✗ ${path.relative(ROOT, contentFile)}: ${e.message}`);
  process.exit(1);
}

if (day.date !== date) err(`date is "${day.date}", file says ${date}`);
if (!day.title || typeof day.title !== "string") err("title missing");
else if (/\bby [A-Z][a-z]+ [A-Z]/.test(day.title)) warn(`title looks like it carries a byline: "${day.title}" (index-row rule: headline only)`);
if (!day.articleUrl || !/^https?:\/\//.test(day.articleUrl)) err("articleUrl missing or not http(s)");
if (!day.source) warn("source missing");
if (day.voiceQuiz !== true) err("voiceQuiz must be true on a new day");
const expectedPage = `/articles/${sub}${date}.html`;
if (day.articlePageUrl !== expectedPage) err(`articlePageUrl should be "${expectedPage}" (got ${JSON.stringify(day.articlePageUrl)})`);
else if (!fs.existsSync(path.join(ROOT, "public", day.articlePageUrl))) err(`captured page public${day.articlePageUrl} does not exist`);

const text = fs.existsSync(textFile) ? norm(fs.readFileSync(textFile, "utf8")) : null;
if (!text) warn(`no captured text at ${path.relative(ROOT, textFile)} — quotes NOT verified against the article`);
// A quote may elide with "…"/"..." — then every fragment must occur, in order.
const quoteFound = (q) => {
  if (!text) return true;
  const frags = norm(q)
    .split(/\s*\.\.\.\s*/)
    .map((f) => f.replace(/^["']+|["']+$/g, "").trim())
    .filter(Boolean);
  if (!frags.length) return false;
  let from = 0;
  for (const f of frags) {
    const at = text.indexOf(f, from);
    if (at < 0) return false;
    from = at + f.length;
  }
  return true;
};
const linkOk = (s) => {
  for (const m of String(s).matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) if (!/^https?:\/\//.test(m[2])) return m[2];
  return null;
};

// --- vocab -------------------------------------------------------------------
const vocab = Array.isArray(day.vocab) ? day.vocab : [];
if (!Array.isArray(day.vocab)) err("vocab must be an array");
if (vocab.length !== 3) err(`vocab has ${vocab.length} words — the recipe is exactly 3`);
vocab.forEach((v, i) => {
  const id = `vocab[${i}]${v?.word ? ` "${v.word}"` : ""}`;
  if (!v?.word) return err(`${id}: word missing`);
  if (!v.partOfSpeech) err(`${id}: partOfSpeech missing`);
  if (!v.pronunciation) err(`${id}: pronunciation respelling missing`);
  else if (!/[A-Z]/.test(v.pronunciation)) warn(`${id}: pronunciation "${v.pronunciation}" has no CAPS stressed syllable`);
  if (!v.articleQuote) err(`${id}: articleQuote missing`);
  else {
    if (!quoteFound(v.articleQuote)) err(`${id}: articleQuote not found verbatim in the article text: "${v.articleQuote}"`);
    const stem = v.word.toLowerCase().slice(0, Math.max(4, v.word.length - 3));
    if (!norm(v.articleQuote).includes(stem)) err(`${id}: articleQuote does not contain the word (or an inflection of it)`);
  }
  if (!v.meaning || v.meaning.length < 80) err(`${id}: meaning missing or too short`);
  if (v.inContext !== undefined) err(`${id}: inContext is legacy — never authored on new days`);
  if (!Array.isArray(v.examples) || v.examples.length !== 2) err(`${id}: examples must be exactly 2 sentences`);
  for (const f of ["meaning", ...(v.examples ?? [])]) {
    const bad = linkOk(f === "meaning" ? v.meaning : f);
    if (bad) err(`${id}: non-http link "${bad}"`);
  }
});
const dupWords = vocab.map((v) => v?.word?.toLowerCase()).filter((w, i, a) => w && a.indexOf(w) !== i);
if (dupWords.length) err(`duplicate vocab word(s): ${dupWords.join(", ")}`);

// --- concepts ------------------------------------------------------------------
const concepts = Array.isArray(day.concepts) ? day.concepts : [];
if (!Array.isArray(day.concepts)) err("concepts must be an array ([] is fine)");
if (concepts.length > 3) err(`concepts has ${concepts.length} — hard cap is 3 (default 2)`);
if (concepts.length === 3) warn("3 concepts — only when the third genuinely shouts");
concepts.forEach((c, i) => {
  const id = `concepts[${i}]${c?.name ? ` "${c.name}"` : ""}`;
  if (!c?.name) return err(`${id}: name missing`);
  if (!c.articleQuote) err(`${id}: articleQuote missing`);
  else if (!quoteFound(c.articleQuote)) err(`${id}: articleQuote not found verbatim in the article text: "${c.articleQuote}"`);
  if (!c.meaning || c.meaning.length < 200) err(`${id}: meaning missing or too short for a concept card`);
  if (c.inContext !== undefined) err(`${id}: inContext is legacy — never authored on new days`);
  const bad = linkOk(c.meaning ?? "");
  if (bad) err(`${id}: non-http link "${bad}"`);
  if (c.link && !/^https?:\/\//.test(c.link.url ?? "")) err(`${id}: link.url must be http(s)`);
});

// --- quiz ------------------------------------------------------------------------
const quiz = Array.isArray(day.quiz) ? day.quiz : [];
if (!Array.isArray(day.quiz)) err("quiz must be an array");
if (quiz.length !== 5) err(`quiz has ${quiz.length} questions — the recipe is 5`);
quiz.forEach((q, i) => {
  const id = `quiz[${i}]`;
  if (!q?.question) err(`${id}: question missing`);
  if (!Array.isArray(q?.options) || q.options.length !== 4) err(`${id}: needs exactly 4 options`);
  if (!Number.isInteger(q?.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) err(`${id}: answerIndex must be 0–3`);
  if (!q?.explanation) err(`${id}: explanation missing`);
  if (Array.isArray(q?.options) && new Set(q.options.map(norm)).size !== q.options.length) err(`${id}: duplicate options`);
});

// --- audio ---------------------------------------------------------------------
if (checkAudio) {
  const need = [
    ...vocab.filter((v) => v?.word).map((v) => v.word),
    ...concepts.filter((c) => c?.name).map((c) => c.name),
  ];
  for (const term of need) {
    const clip = path.join(audioDir, `${slug(term)}.mp3`);
    if (!fs.existsSync(clip)) err(`no pronunciation clip for "${term}" (${path.relative(ROOT, clip)}) — run scripts/gen-pronunciation.mjs ${date}${track === "junior" ? " --track=junior" : ""}`);
  }
  if (!fs.existsSync(path.join(audioDir, "quiz-intro.mp3"))) err(`quiz-intro.mp3 missing in ${path.relative(ROOT, audioDir)}`);
  const glossary = path.join(ROOT, "public", "glossaries", sub, `${date}.json`);
  if (!fs.existsSync(glossary)) warn(`no glossary at ${path.relative(ROOT, glossary)} (every captured-page day should have one)`);
  else if (!fs.existsSync(path.join(audioDir, "gloss"))) warn("glossary exists but no gloss/ audio dir — run scripts/gen-glossary-audio.mjs");
}

// --- report ----------------------------------------------------------------------
for (const w of warnings) console.log(`  warn: ${w}`);
for (const e of errors) console.log(`  ERROR: ${e}`);
if (errors.length) {
  console.log(`✗ ${path.relative(ROOT, contentFile)}: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
console.log(`ok ${path.relative(ROOT, contentFile)} — ${vocab.length} words, ${concepts.length} concept(s), ${quiz.length} questions${text ? ", all quotes verified" : ""}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
