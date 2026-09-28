// The club's already-published readings (both tracks) as a do-not-repeat set.
// A candidate is a duplicate if its normalized URL OR title matches a published
// reading — titles drift in capitalization and URLs in /interactive/ prefixes,
// so each check covers the other's blind spot — or if it is a NEAR match: The
// Economist re-slugs and re-headlines pieces after publication ("America and
// China's leaders…" became "America's and China's leaders…" the next day,
// with a new slug), so a same-section, same-date URL whose slug words almost
// all match, or a title whose words almost all match, is the same article.
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

// Word tokens for near matching: lowercase, punctuation out, possessives and
// plural/possessive trailing s folded ("america's" / "americas" / "america").
function tokens(text) {
  return new Set(
    normalizeTitle(text)
      .replace(/['’]s\b/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1)
      .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)),
  );
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / (a.size + b.size - hit);
}
const NEAR = 0.8;
// A dated Economist-style path → { key: "section/yyyy/mm/dd", slug }.
const DATED_RE = /\/([a-z0-9-]+)\/(20\d\d\/\d{2}\/\d{2})\/([a-z0-9-]+)$/i;
function datedParts(url) {
  const m = normalizeUrl(url).match(DATED_RE);
  return m ? { key: `${m[1]}/${m[2]}`, slug: tokens(m[3].replace(/-/g, " ")) } : null;
}

// Returns { urls: Set, titles: Set, readings: [{title, url, dated, titleTokens}], count }
// across content/ and content/junior/.
export function loadPublished() {
  const urls = new Set();
  const titles = new Set();
  const readings = [];
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
        readings.push({
          title: day.title ?? "",
          url: day.articleUrl ?? "",
          dated: day.articleUrl ? datedParts(day.articleUrl) : null,
          titleTokens: day.title ? tokens(day.title) : new Set(),
        });
        count++;
      } catch {
        // an unparseable content file is the build's problem, not the scout's
      }
    }
  }
  return { urls, titles, readings, count };
}

// The published reading a candidate duplicates (exact or near), or null.
export function publishedMatch(published, { url, title }) {
  if (url !== undefined && published.urls.has(normalizeUrl(url))) return { exact: true, url };
  if (title !== undefined && published.titles.has(normalizeTitle(title))) return { exact: true, title };
  const dated = url !== undefined ? datedParts(url) : null;
  const tt = title !== undefined ? tokens(title) : null;
  for (const r of published.readings) {
    if (dated && r.dated && r.dated.key === dated.key && jaccard(dated.slug, r.dated.slug) >= NEAR) {
      return { exact: false, url: r.url, title: r.title };
    }
    if (tt && r.titleTokens.size && jaccard(tt, r.titleTokens) >= NEAR) {
      return { exact: false, url: r.url, title: r.title };
    }
  }
  return null;
}

export function isPublished(published, { url, title }) {
  return publishedMatch(published, { url, title }) !== null;
}

// The track's most recent readings, newest first, as "YYYY-MM-DD  title" lines —
// context the pickers print so the ranker knows what the club has read lately.
export function recentReadings(track = "senior", n = 10) {
  const dir = track === "junior" ? "content/junior" : "content";
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse()
    .slice(0, n)
    .map((name) => {
      try {
        const day = JSON.parse(fs.readFileSync(path.join(abs, name), "utf8"));
        return `${name.slice(0, 10)}  ${day.title ?? "(untitled)"}`;
      } catch {
        return `${name.slice(0, 10)}  (unreadable)`;
      }
    });
}
