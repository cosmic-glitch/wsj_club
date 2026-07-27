// Generate pronunciation clips (OpenAI TTS, `alloy`) for a page's tap-a-word
// GLOSSARY entries — every entry, not just the handout vocab — saved as static
// clips the article page's bottom sheet plays via its speaker button:
//   public/audio/<date>/gloss/<k>.mp3        (junior/<date> for junior pages)
// and stamps `audio: true` on each entry in public/glossaries/<name>.json so
// glossary.js knows a clip exists (no flag -> no button, never a dead one).
//
// Usage:
//   node --env-file=.env.local scripts/gen-glossary-audio.mjs 2026-07-26
//   node --env-file=.env.local scripts/gen-glossary-audio.mjs junior/2026-07-15
//   node --env-file=.env.local scripts/gen-glossary-audio.mjs 2026-06-14-1   # multi-article page
//   ... --force to regenerate existing clips
//
// <name> is the GLOSSARY name (same as check-glossary.mjs). Multi-article
// pages (-1/-2 suffix) share the date's audio dir, mirroring how glossary.js
// derives the path client-side. Idempotent: existing clips are skipped (but
// still stamped) unless --force.

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
const name = args.find((a) => !a.startsWith("--"));
if (!name) {
  console.error("usage: gen-glossary-audio.mjs <name> [--force]   e.g. 2026-07-26 or junior/2026-07-15");
  process.exit(1);
}

const ROOT = process.cwd();
const glossaryFile = path.join(ROOT, "public/glossaries", `${name}.json`);
// Audio lives under the DATE (multi-article pages share it): strip a -N page
// suffix, keep the junior/ segment. Must match the derivation in glossary.js.
const dateDir = name.replace(/^((?:junior\/)?\d{4}-\d{2}-\d{2}).*$/, "$1");
const outDir = path.join(ROOT, "public/audio", dateDir, "gloss");

const entries = JSON.parse(fs.readFileSync(glossaryFile, "utf8"));
fs.mkdirSync(outDir, { recursive: true });

const INSTRUCTIONS =
  "Say the following word or phrase clearly and naturally in standard " +
  "American English, at a calm, unhurried pace with the correct stress. " +
  "Say it once; do not spell it out.";

async function tts(text) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      voice: VOICE,
      input: text,
      response_format: "mp3",
      instructions: INSTRUCTIONS,
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return trimLeadingSilence(Buffer.from(await res.arrayBuffer()));
}

// The TTS clips arrive with ~0.4s of leading silence, a noticeable lag when
// the speaker button is pressed. Trim it (keeping 50ms) via ffmpeg; if ffmpeg
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

await mapLimit(entries, 6, async (e) => {
  const file = path.join(outDir, `${e.k}.mp3`);
  if (!force && fs.existsSync(file)) {
    e.audio = true;
    skipped++;
    return;
  }
  try {
    const buf = await tts(e.t);
    fs.writeFileSync(file, buf);
    e.audio = true;
    made++;
    console.log(`ok   ${dateDir}/gloss/${e.k}.mp3  "${e.t}"  (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${dateDir}/gloss/${e.k}.mp3  <- "${e.t}"  ${err.message}`);
  }
});

fs.writeFileSync(glossaryFile, JSON.stringify(entries, null, 2) + "\n");
console.log(`\nDone. ${name}: made=${made} skipped=${skipped} failed=${failed}  voice=${VOICE} model=${MODEL}`);
if (failed) process.exit(1);
