#!/usr/bin/env node
// Add the tap-a-word glossary tags to served article pages.
// Usage: node scripts/add-glossary-tags.mjs public/articles/2026-07-23.html [more.html ...]
//        node scripts/add-glossary-tags.mjs --all
// Idempotent: pages that already reference /glossary.js are skipped.
// The page only shows the feature if /glossaries/<page>.json exists —
// injecting the tags into a page with no glossary is harmless (silent no-op).
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ARTICLES = path.join(ROOT, "public/articles");

let files = process.argv.slice(2);
if (files[0] === "--all") {
  files = fs.readdirSync(ARTICLES).filter(f => f.endsWith(".html")).map(f => path.join(ARTICLES, f));
  const jr = path.join(ARTICLES, "junior");
  if (fs.existsSync(jr)) files.push(...fs.readdirSync(jr).filter(f => f.endsWith(".html")).map(f => path.join(jr, f)));
}
if (!files.length) {
  console.error("usage: add-glossary-tags.mjs <page.html ...> | --all");
  process.exit(1);
}

const LINK = '<link rel="stylesheet" href="/glossary.css">';
const SCRIPT = '<script src="/glossary.js" defer></script>';

for (const file of files) {
  let html = fs.readFileSync(file, "utf8");
  if (html.includes("/glossary.js")) { console.log("skip (already tagged):", file); continue; }
  if (!html.includes("</head>") || !html.includes("</body>")) { console.error("NO ANCHORS:", file); process.exitCode = 1; continue; }
  html = html.replace("</head>", LINK + "\n</head>");
  html = html.replace("</body>", SCRIPT + "\n</body>");
  fs.writeFileSync(file, html);
  console.log("tagged:", file);
}
