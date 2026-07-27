// Generate US-English pronunciation audio (OpenAI TTS, `alloy`) for a day's
// vocabulary words and concept names, saved as static clips the handout plays
// via the ▶ button:  public/audio/<date>/<slug>.mp3  (committed + CDN-served,
// like public/pdfs). The clip speaks the real word — not a respelling — so the
// handout shows no phonetic text.
//
// ALSO generates the day's AI-quiz spoken opening, quiz-intro.mp3 — the tutor
// voice greeting the student and NAMING THE ARTICLE ("Hey there! Explain the
// key ideas in the article: <title>."), played when the voice quiz starts. The
// title is spoken so a student who launched the quiz from the wrong day's row
// hears it before recording. Its text must stay the first sentences of
// openingLine() in components/VoiceQuiz.tsx; its voice/tone mirror
// app/api/quiz-tts/route.ts so the opening sounds like the rest of the tutor.
//
// Usage:
//   node --env-file=.env.local scripts/gen-pronunciation.mjs 2026-07-14   # one day
//   node --env-file=.env.local scripts/gen-pronunciation.mjs all          # every day
//   node --env-file=.env.local scripts/gen-pronunciation.mjs all --force  # regenerate all
//   node --env-file=.env.local scripts/gen-pronunciation.mjs 2026-07-16 --track=junior  # junior track
//
// Idempotent: existing clips are skipped unless --force. The filename slug MUST
// match slugify() in lib/handout-audio.ts, or the handout won't find them.
// Voice/model are env-overridable (PRONOUNCE_VOICE / PRONOUNCE_MODEL).
//
// --track=junior repoints BOTH bases up front (read from content/junior/, write
// to public/audio/junior/), which is enough for all three senior-hardcoded
// spots: the `all` sweep enumerates whichever CONTENT dir, the per-day read, and
// the outDir write.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error("OPENAI_API_KEY missing — run with --env-file=.env.local");
  process.exit(1);
}

const MODEL = process.env.PRONOUNCE_MODEL || "gpt-4o-mini-tts";
const VOICE = process.env.PRONOUNCE_VOICE || "alloy";

const args = process.argv.slice(2);
const force = args.includes("--force");
// --track=junior (unambiguous equals form, so it never collides with the
// positional date/all target below, which excludes anything starting with --).
const trackArg = args.find((a) => a.startsWith("--track="));
const track = trackArg ? trackArg.split("=")[1] : "senior";
const CONTENT =
  track === "junior"
    ? path.join(process.cwd(), "content", "junior")
    : path.join(process.cwd(), "content");
const AUDIO =
  track === "junior"
    ? path.join(process.cwd(), "public", "audio", "junior")
    : path.join(process.cwd(), "public", "audio");

const target = args.find((a) => !a.startsWith("--")) || "all";

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const INSTRUCTIONS =
  "Say the following word or phrase clearly and naturally in standard " +
  "American English, at a normal conversational pace with the correct " +
  "stress. Say it once; do not spell it out.";

// The quiz-intro clip mirrors the tutor's live TTS (app/api/quiz-tts/route.ts):
// same env knobs, same defaults, same tone instructions — the pre-generated
// opening must sound like the same tutor who asks the follow-ups.
const INTRO_MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";
const INTRO_VOICE = process.env.TTS_VOICE || "onyx";
const INTRO_INSTRUCTIONS =
  "Speak as a warm, friendly, encouraging tutor talking to a teenager. " +
  "Speak at a brisk, lively pace — clearly faster than an unhurried read " +
  "(about 30% quicker), while still sounding natural. Clear and plain.";

// Keep in sync with the first sentences of openingLine() in
// components/VoiceQuiz.tsx.
const introText = (title) =>
  `Hey there! Explain the key ideas in the article: ${title.trim()}.`;

function daysToProcess() {
  // The junior content dir may not exist yet (before the first junior reading).
  if (!fs.existsSync(CONTENT)) {
    console.error(`No content directory at ${CONTENT}`);
    process.exit(1);
  }
  const all = fs
    .readdirSync(CONTENT)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  if (target === "all") return all;
  if (!all.includes(target)) {
    console.error(`No content file for ${target}`);
    process.exit(1);
  }
  return [target];
}

async function tts(text, { model = MODEL, voice = VOICE, instructions = INSTRUCTIONS } = {}) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: "mp3",
      instructions,
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return trimLeadingSilence(Buffer.from(await res.arrayBuffer()));
}

// The TTS clips arrive with ~0.4s of leading silence, a noticeable lag when
// the ▶ button is pressed. Trim it (keeping 50ms) via ffmpeg; if ffmpeg
// isn't installed or chokes, keep the raw clip — a slow clip beats no clip.
function trimLeadingSilence(buf) {
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", "pipe:0",
     "-af", "silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.05",
     "-c:a", "libmp3lame", "-q:a", "4", "-f", "mp3", "pipe:1"],
    { input: buf, maxBuffer: 64 * 1024 * 1024 },
  );
  return r.status === 0 && r.stdout?.length ? r.stdout : buf;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

let made = 0;
let skipped = 0;
let failed = 0;

for (const date of daysToProcess()) {
  const reading = JSON.parse(fs.readFileSync(path.join(CONTENT, `${date}.json`), "utf8"));
  const terms = [
    ...(reading.vocab || []).map((w) => w.word),
    ...(reading.concepts || []).map((c) => c.name),
  ].filter(Boolean);
  const outDir = path.join(AUDIO, date);
  fs.mkdirSync(outDir, { recursive: true });

  // The day's AI-quiz opening clip (see header comment). Same skip/--force
  // rules as the word clips. "quiz-intro" can't collide with a term clip
  // unless a vocab word were literally "quiz intro".
  const introFile = path.join(outDir, "quiz-intro.mp3");
  if (force || !fs.existsSync(introFile)) {
    try {
      const buf = await tts(introText(reading.title), {
        model: INTRO_MODEL,
        voice: INTRO_VOICE,
        instructions: INTRO_INSTRUCTIONS,
      });
      fs.writeFileSync(introFile, buf);
      made++;
      console.log(`ok   ${date}/quiz-intro.mp3  (${(buf.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${date}/quiz-intro.mp3  <- "${reading.title}"  ${e.message}`);
    }
  } else {
    skipped++;
  }

  await mapLimit(terms, 6, async (term) => {
    const file = path.join(outDir, `${slug(term)}.mp3`);
    if (!force && fs.existsSync(file)) {
      skipped++;
      return;
    }
    try {
      const buf = await tts(term);
      fs.writeFileSync(file, buf);
      made++;
      console.log(`ok   ${date}/${slug(term)}.mp3  (${(buf.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${date}/${slug(term)}.mp3  <- "${term}"  ${e.message}`);
    }
  });
}

console.log(`\nDone. track=${track} made=${made} skipped=${skipped} failed=${failed}  voice=${VOICE} model=${MODEL}`);
if (failed) process.exit(1);
