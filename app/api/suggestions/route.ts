import { currentUser, isOwner } from "@/lib/auth";
import { dbSelect, dbUpsert } from "@/lib/db";
import type { Track } from "@/lib/content";

/**
 * Club article suggestions — the "Suggest" link in the topline auth bar
 * (components/SuggestArticle.tsx). A member submits a URL and a track; that's
 * the whole form. Suggestions land in `rc_suggestions` with status "open" and
 * are read owner-side by `scripts/suggestions.mjs`, which is what the
 * wsj-pick-article / wsj-pick-article-junior skills run so every open
 * suggestion is evaluated alongside the candidates they scout themselves.
 *
 * Write-only for members: a suggestion is a note to the owner, not a public
 * list — surfacing who suggested what (or how many are queued) on the site
 * would turn it into a second, competing vote. The one reader is the OWNER's
 * GET below (the topline "Suggestions" panel, components/SuggestionsQueue.tsx),
 * which shows the open queue with suggester names. Resolution stays in
 * scripts/suggestions.mjs — the site never closes a suggestion.
 *
 * Identity ALWAYS comes from the signed cookie, never the body — `track` is
 * the only thing the request gets to say, and it's a label (which picker
 * should see this), not a permission.
 */

/** "senior" | "junior" from an untrusted request value (default senior — the same boundary rule as the vote/quiz routes). */
function parseTrack(v: unknown): Track {
  return v === "junior" ? "junior" : "senior";
}

// Enough rope for a real article URL with tracking junk, not enough to use the
// table as a text store.
const MAX_URL_LENGTH = 600;

// A member with this many unresolved suggestions is spamming (or lost) — the
// queue is a shortlist the owner reads by hand, so it stays small.
const MAX_OPEN_PER_USER = 10;

/** The submitted string as a normalized http(s) URL, or null if it isn't one. */
function parseUrl(raw: string): string | null {
  if (!raw || raw.length > MAX_URL_LENGTH) return null;
  // A pasted link often arrives bare ("wsj.com/..."), which the URL parser
  // rejects; assume https rather than bouncing the member back to the form.
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

// GET /api/suggestions → { suggestions: [{ id, track, url, username, created_at }] }
// Owner-only: the open queue, newest first.
export async function GET() {
  const user = await currentUser();
  if (!user || !isOwner(user)) {
    return Response.json({ error: "Not allowed." }, { status: 403 });
  }
  try {
    const rows = await dbSelect(
      "rc_suggestions",
      "?status=eq.open&select=id,track,url,username,created_at&order=created_at.desc"
    );
    if (rows === null) throw new Error("suggestion DB read failed");
    return Response.json({ suggestions: rows });
  } catch (err) {
    console.error("Listing suggestions failed:", err, "user:", user);
    return Response.json(
      { error: "Could not load the suggestions." },
      { status: 502 }
    );
  }
}

// POST /api/suggestions { url, track? } → { ok: true }
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  let body: { url?: unknown; track?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const track = parseTrack(body.track);
  const url = parseUrl(String(body.url ?? "").trim());
  if (!url) {
    return Response.json(
      { error: "That doesn't look like a link. Paste the article's web address." },
      { status: 400 }
    );
  }

  try {
    const open = await dbSelect(
      "rc_suggestions",
      `?username=eq.${encodeURIComponent(user)}&status=eq.open&select=id`
    );
    if (open === null) throw new Error("suggestion DB read failed");
    if (open.length >= MAX_OPEN_PER_USER) {
      return Response.json(
        {
          error:
            "You already have plenty of suggestions in the queue — wait for those to be read first.",
        },
        { status: 429 }
      );
    }

    const now = new Date().toISOString();
    // Upsert on (track, url, username): re-sending the same link updates the
    // one row instead of piling up, and re-opens it if it was declined.
    const ok = await dbUpsert(
      "rc_suggestions",
      {
        track,
        url,
        username: user,
        status: "open",
        resolved_at: null,
        updated_at: now,
      },
      "track,url,username"
    );
    if (!ok) {
      return Response.json(
        { error: "Could not save your suggestion." },
        { status: 502 }
      );
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Saving a suggestion failed:", err, "user:", user);
    return Response.json(
      { error: "Could not save your suggestion." },
      { status: 502 }
    );
  }
}
