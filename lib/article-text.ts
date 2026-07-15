import { get } from "@vercel/blob";
import type { Track } from "@/lib/content";

/**
 * The voice tutor works best when it can see the *full* article, not just the
 * handout — so it can judge whether the student's from-memory retelling covered
 * the real, non-obvious ideas. We don't commit the full WSJ text to this public
 * repo (CLAUDE.md: never republish the article text); instead each day's plain
 * text lives in **Vercel Blob** at `article-text/<date>.txt`, uploaded with
 * `scripts/upload-article-text.mjs`. (The store is public, like the rest of the
 * app's Blob data — but that's no new exposure: the full article PDF is already
 * public at a guessable /pdfs/ URL. Keeping the bulk text out of git is the
 * point.) This reads it back server-side.
 *
 * Returns null when there's no text for that day (older articles, or before an
 * upload) — callers fall back to a handout-only quiz, which is the prior
 * behaviour. Best-effort: a Blob hiccup never blocks a session.
 */

// Junior text lives under an extra `junior/` segment, mirroring the content /
// PDF / audio / session key convention (see lib/session-io.ts sessionPrefix).
const articleTextPath = (date: string, track: Track) =>
  track === "junior" ? `article-text/junior/${date}.txt` : `article-text/${date}.txt`;

// Small per-instance cache — a warm function reuses the text across sessions
// instead of re-fetching from Blob every time. Keyed by track+date so the two
// tracks' same-date texts don't collide.
const cache = new Map<string, string>();

export async function getArticleText(
  date: string,
  track: Track = "senior"
): Promise<string | null> {
  const cacheKey = `${track}:${date}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;

  try {
    const result = await get(articleTextPath(date, track), { access: "public" });
    if (!result || result.statusCode !== 200) return null;
    const text = (await new Response(result.stream).text()).trim();
    if (!text) return null;
    cache.set(cacheKey, text);
    return text;
  } catch {
    // Not found / token issue / network — degrade to handout-only.
    return null;
  }
}
