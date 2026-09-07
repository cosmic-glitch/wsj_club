import { currentUserRecord } from "@/lib/auth";
import { parseEventInput, recordEvent } from "@/lib/events";

/**
 * POST /api/events — the page-activity beacon (lib/events.ts).
 *
 * Public: a logged-out visitor's event is recorded too, with a null username
 * (the analytics page's separate "anonymous" bucket). Identity comes ONLY from
 * the signed cookie — the body names no user (the site-wide invariant). The
 * body is plain text carrying JSON: navigator.sendBeacon sends a string as
 * text/plain, and the React leaf matches it, so one parser serves both.
 *
 * Obvious crawlers are dropped before the insert (the article pages are
 * noindex but still get fetched by link-preview bots); a missing User-Agent
 * is treated the same. Every outcome is a 204 — a beacon has no reader.
 */

const BOT_UA =
  /bot|crawl|spider|slurp|preview|fetch|headless|python|curl|wget|httpclient|facebookexternalhit|whatsapp|telegram|discord|embedly|quora|pinterest|vkshare|w3c_validator/i;

export async function POST(request: Request) {
  const ua = request.headers.get("user-agent") ?? "";
  if (!ua || BOT_UA.test(ua)) return new Response(null, { status: 204 });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new Response(null, { status: 204 });
  }
  const input = parseEventInput(body);
  if (!input) return new Response(null, { status: 204 });

  // One record read gives identity, role and classroom; an inactive account
  // reads as anonymous (same as currentUser's rule).
  const record = await currentUserRecord();
  const user = record && record.active !== false ? record : null;
  const who = user
    ? {
        username: user.username,
        // A student's classroom is their parent's; a parent's own activity is
        // stamped to themselves (the rc_quiz_sessions recipe).
        parentId: user.role === "student" ? user.parentId ?? null : user.username,
      }
    : { username: null, parentId: null };

  const ok = await recordEvent(input, who);
  if (!ok) console.error("events: insert failed", { kind: input.kind, user: who.username });
  return new Response(null, { status: 204 });
}
