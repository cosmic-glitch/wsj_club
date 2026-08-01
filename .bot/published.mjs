// The club's already-published readings (both tracks) as a do-not-repeat set.
// A candidate is a duplicate if its normalized URL OR title matches a published
// reading — titles drift in capitalization and URLs in /interactive/ prefixes,
// so each check covers the other's blind spot.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const pathname = u.pathname.replace(/^\/interactive(?=\/)/, "").replace(/\/+$/, "");
    return `${host}${pathname}`.toLowerCase();
  } catch {
    return String(url).trim().toLowerCase();
  }
}

export function normalizeTitle(title) {
  return String(title)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Returns { urls: Set, titles: Set, count } across content/ and content/junior/.
export function loadPublished() {
  const urls = new Set();
  const titles = new Set();
  let count = 0;
  for (const dir of ["content", "content/junior"]) {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
      try {
        const day = JSON.parse(fs.readFileSync(path.join(abs, name), "utf8"));
        if (day.articleUrl) urls.add(normalizeUrl(day.articleUrl));
        if (day.title) titles.add(normalizeTitle(day.title));
        count++;
      } catch {
        // an unparseable content file is the build's problem, not the scout's
      }
    }
  }
  return { urls, titles, count };
}

export function isPublished(published, { url, title }) {
  return (
    (url !== undefined && published.urls.has(normalizeUrl(url))) ||
    (title !== undefined && published.titles.has(normalizeTitle(title)))
  );
}
