#!/usr/bin/env node
/**
 * Upload a day's FULL article plain text to Vercel Blob, where the voice quiz
 * reads it (see lib/article-text.ts). We keep the full text OUT of this public
 * repo — CLAUDE.md's hard rule is never to republish article text — so Blob is
 * its home. (The store is public, like the rest of the app's Blob data; that's
 * no new exposure since the article PDF is already public.) Days without an
 * uploaded text fall back to a handout-only quiz.
 *
 * The text usually comes straight from the day's served PDF, which is already
 * text (the wsj-reading skill captures it text-focused):
 *
 *   pdftotext public/pdfs/2026-06-18.pdf article-text/2026-06-18.txt
 *   node --env-file=.env.local scripts/upload-article-text.mjs 2026-06-18
 *
 * Needs BLOB_READ_WRITE_TOKEN (it's in .env.local — `--env-file=.env.local`
 * loads it). Pass the date; it reads article-text/<date>.txt by default, or
 * give an explicit file path as the second arg, or pipe text on stdin.
 *
 * Usage:
 *   node --env-file=.env.local scripts/upload-article-text.mjs <YYYY-MM-DD> [file]
 *   pdftotext file.pdf - | node --env-file=.env.local scripts/upload-article-text.mjs <YYYY-MM-DD>
 */
import fs from "node:fs";
import { put } from "@vercel/blob";

const [date, file] = process.argv.slice(2);

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: node --env-file=.env.local scripts/upload-article-text.mjs <YYYY-MM-DD> [file]");
  process.exit(1);
}

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("Missing BLOB_READ_WRITE_TOKEN. Run with: node --env-file=.env.local scripts/upload-article-text.mjs ...");
  process.exit(1);
}

function readText() {
  const path = file || `article-text/${date}.txt`;
  if (file === "-" || (!file && !fs.existsSync(path))) {
    return fs.readFileSync(0, "utf8"); // stdin
  }
  if (!fs.existsSync(path)) {
    console.error(`No text file at ${path}. Create it (e.g. pdftotext public/pdfs/${date}.pdf ${path}) or pipe text on stdin.`);
    process.exit(1);
  }
  return fs.readFileSync(path, "utf8");
}

const text = readText().trim();
if (!text) {
  console.error("Refusing to upload empty text.");
  process.exit(1);
}

const blob = await put(`article-text/${date}.txt`, text, {
  access: "public",
  allowOverwrite: true,
  addRandomSuffix: false, // deterministic pathname so the app reads it by path
  contentType: "text/plain; charset=utf-8",
});

console.log(`Uploaded ${text.length} chars (~${text.split(/\s+/).length} words) to Vercel Blob:`);
console.log(`  ${blob.pathname}`);
console.log("The voice quiz will now give the tutor the full article for this day.");
