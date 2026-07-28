#!/usr/bin/env node
/**
 * Upload a day's FULL article plain text to Vercel Blob, where the voice quiz
 * reads it (see lib/article-text.ts). We keep the full text OUT of this public
 * repo — CLAUDE.md's hard rule is never to republish article text — so Blob is
 * its home. (The store is public, like the rest of the app's Blob data; the
 * served article page is public too.) Days without an uploaded text fall back
 * to a handout-only quiz.
 *
 * The text file is normally already on disk: the wsj-reading skill's capture
 * step writes article-text/<date>.txt in the same pass that builds the day's
 * article page, so this is just the upload:
 *
 *   node --env-file=.env.local scripts/upload-article-text.mjs 2026-06-18
 *
 * Needs BLOB_READ_WRITE_TOKEN (it's in .env.local — `--env-file=.env.local`
 * loads it). Pass the date; it reads article-text/<date>.txt by default, or
 * give an explicit file path as the second arg, or pipe text on stdin.
 *
 * Usage:
 *   node --env-file=.env.local scripts/upload-article-text.mjs <YYYY-MM-DD> [file]
 *   node --env-file=.env.local scripts/upload-article-text.mjs <YYYY-MM-DD> --track=junior
 *   cat some.txt | node --env-file=.env.local scripts/upload-article-text.mjs <YYYY-MM-DD>
 *
 * --track=junior uploads to the junior Blob key `article-text/junior/<date>.txt`
 * and defaults the local source to `article-text/junior/<date>.txt`.
 */
import fs from "node:fs";
import { put } from "@vercel/blob";

const argv = process.argv.slice(2);
const trackArg = argv.find((a) => a.startsWith("--track="));
const track = trackArg ? trackArg.split("=")[1] : "senior";
const [date, file] = argv.filter((a) => !a.startsWith("--"));

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: node --env-file=.env.local scripts/upload-article-text.mjs <YYYY-MM-DD> [file] [--track=junior]");
  process.exit(1);
}

// Junior text lives under an extra `junior/` segment (Blob key + local default).
const textDir = track === "junior" ? "article-text/junior" : "article-text";
const blobKey = `${textDir}/${date}.txt`;

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("Missing BLOB_READ_WRITE_TOKEN. Run with: node --env-file=.env.local scripts/upload-article-text.mjs ...");
  process.exit(1);
}

function readText() {
  const path = file || `${textDir}/${date}.txt`;
  if (file === "-" || (!file && !fs.existsSync(path))) {
    return fs.readFileSync(0, "utf8"); // stdin
  }
  if (!fs.existsSync(path)) {
    console.error(`No text file at ${path}. The wsj-reading capture step normally writes it; otherwise create it by hand (headline + deck first, then the body) or pipe text on stdin.`);
    process.exit(1);
  }
  return fs.readFileSync(path, "utf8");
}

const text = readText().trim();
if (!text) {
  console.error("Refusing to upload empty text.");
  process.exit(1);
}

const blob = await put(blobKey, text, {
  access: "public",
  allowOverwrite: true,
  addRandomSuffix: false, // deterministic pathname so the app reads it by path
  contentType: "text/plain; charset=utf-8",
});

console.log(`Uploaded ${text.length} chars (~${text.split(/\s+/).length} words) to Vercel Blob:`);
console.log(`  ${blob.pathname}`);
console.log("The voice quiz will now give the tutor the full article for this day.");
