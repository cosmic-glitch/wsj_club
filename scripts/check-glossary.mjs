#!/usr/bin/env node
// Validate a page's tap-a-word glossary against the article page's text.
// Usage: node scripts/check-glossary.mjs <name>            e.g. 2026-07-23 or junior/2026-07-15
//        node scripts/check-glossary.mjs <name> --dump-text  print the extracted article text and exit
//        node scripts/check-glossary.mjs --all              validate every glossary in public/glossaries
// Checks: JSON parses; keys unique + kebab-case; kinds valid; vocab entries carry pron;
// every entry has >=1 form found in the page text (same word-boundary regex as glossary.js).
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function extractText(name) {
  const html = fs.readFileSync(path.join(ROOT, "public/articles", name + ".html"), "utf8");
  const noImg = html.replace(/<img[^>]*>/g, "").replace(/<figcaption>[\s\S]*?<\/figcaption>/g, "");
  const main = noImg.match(/<main>[\s\S]*<\/main>/)[0]
    .replace(/<div class="top">[\s\S]*?<\/div>/, "");
  const blocks = [...main.matchAll(/<(h1|h2|p)[^>]*>([\s\S]*?)<\/\1>/g)]
    .map(m => m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim())
    .filter(Boolean);
  return blocks.join("\n\n");
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function formRe(f) { return new RegExp("(^|[^A-Za-z\\u00C0-\\u024F-])(" + escRe(f) + ")(?![A-Za-z\\u00C0-\\u024F-])", "i"); }

function validate(name) {
  const text = extractText(name);
  const file = path.join(ROOT, "public/glossaries", name + ".json");
  const entries = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = [], warnings = [];
  if (!Array.isArray(entries) || !entries.length) errors.push("not a non-empty array");
  const keys = new Set();
  for (const e of entries) {
    const id = e.k || "(no key)";
    if (!e.k || !/^[a-z0-9-]+$/.test(e.k)) errors.push(`${id}: bad key`);
    if (keys.has(e.k)) errors.push(`${id}: duplicate key`);
    keys.add(e.k);
    if (!["vocab", "word", "phrase", "name"].includes(e.kind)) errors.push(`${id}: bad kind "${e.kind}"`);
    if (e.kind === "vocab" && !e.pron) warnings.push(`${id}: vocab without pron`);
    if (!e.t || !e.text || !Array.isArray(e.forms) || !e.forms.length) { errors.push(`${id}: missing t/text/forms`); continue; }
    if (!e.forms.some(f => formRe(f).test(text))) errors.push(`${id}: no form found in article text (forms: ${e.forms.join(", ")})`);
    if (/In this article:|In general:/.test(e.text)) errors.push(`${id}: text has section labels — must be one woven explanation`);
    if (/\*\*|\*[A-Za-z][^*\n]{0,60}\*/.test(e.text)) errors.push(`${id}: text has markdown asterisks — glossary.js renders plain text`);
  }
  return { count: entries.length, errors, warnings };
}

const arg = process.argv[2];
if (!arg) { console.error("usage: check-glossary.mjs <name> [--dump-text] | --all"); process.exit(1); }

let names;
if (arg === "--all") {
  const dir = path.join(ROOT, "public/glossaries");
  names = fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, ""));
  const jr = path.join(dir, "junior");
  if (fs.existsSync(jr)) names.push(...fs.readdirSync(jr).filter(f => f.endsWith(".json")).map(f => "junior/" + f.replace(/\.json$/, "")));
} else if (process.argv.includes("--dump-text")) {
  console.log(extractText(arg));
  process.exit(0);
} else {
  names = [arg];
}

let failed = false;
for (const name of names) {
  try {
    const { count, errors, warnings } = validate(name);
    const status = errors.length ? "FAIL" : "ok";
    if (errors.length) failed = true;
    console.log(`${status}  ${name}  (${count} entries${warnings.length ? `, ${warnings.length} warnings` : ""})`);
    errors.forEach(e => console.log("   ERROR:", e));
    warnings.forEach(w => console.log("   warn:", w));
  } catch (err) {
    failed = true;
    console.log(`FAIL  ${name}  ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
