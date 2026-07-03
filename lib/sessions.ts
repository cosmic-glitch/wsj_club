import { list } from "@vercel/blob";
import type { Session } from "@/components/AdminSessions";

/**
 * Load every saved voice-quiz session from Blob (used by the Scores page and the
 * Students roster). Audio recordings (.webm/.mp4/.wav) live in the SAME prefix
 * as the session JSON, so only fetch/parse the .json files — never try to
 * JSON.parse a recording. Each parse is independently guarded so one corrupt
 * blob can't take down the page (returns null → filtered out).
 *
 * `blobUrl` is attached at load time (it isn't part of the saved JSON) so the
 * teacher can delete an attempt.
 */
export async function loadSessions(): Promise<Session[] | { error: string }> {
  try {
    const { blobs } = await list({ prefix: "quiz-sessions/" });
    const sessions = (
      await Promise.all(
        blobs
          .filter((b) => b.pathname.endsWith(".json"))
          .map(async (b) => {
            try {
              const res = await fetch(b.url, { cache: "no-store" });
              const session = (await res.json()) as Session;
              return { ...session, blobUrl: b.url };
            } catch (err) {
              console.error("Skipping unreadable session blob:", b.pathname, err);
              return null;
            }
          })
      )
    ).filter((s): s is Session => s !== null);
    return sessions;
  } catch (err) {
    console.error("Loading quiz sessions failed:", err);
    return { error: "Could not load sessions (is Blob storage configured?)." };
  }
}
