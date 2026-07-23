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
 * owner can delete an attempt. The stored JSON stamps the owning parent under
 * the legacy `teacherId` field name — normalized to `parentId` here, so nothing
 * above this loader sees the legacy name.
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
              // Key the URL by uploadedAt: the in-progress slot is overwritten
              // in place, and the Blob CDN edge-caches by URL — a plain
              // no-store fetch can serve a stale copy right after an overwrite
              // (same trap lib/users.ts documents). list() metadata is
              // read-after-write consistent, so this forces current content.
              // Harmless for the immutable random-suffixed records.
              const v = new Date(b.uploadedAt).getTime();
              const res = await fetch(`${b.url}?v=${v}`, { cache: "no-store" });
              const raw = (await res.json()) as Session & { teacherId?: string };
              const { teacherId, ...session } = raw;
              return {
                ...session,
                ...(teacherId ? { parentId: teacherId } : {}),
                blobUrl: b.url,
              };
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
