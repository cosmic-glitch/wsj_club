import { list } from "@vercel/blob";
import type { Report, Session, Turn } from "@/components/AdminSessions";

/**
 * The full on-disk session shape — a superset of the slim `Session` the pages
 * work with. The heavy fields (transcript, the report narrative, diag) are
 * DELIBERATELY not returned by loadSessions: they're only ever read inside the
 * Details modal, which fetches this record's blobUrl directly on open. Keeping
 * them out of the loader's return keeps the Scores page's RSC payload small
 * (the transcripts + diag were the bulk of ~1.5MB shipped per view).
 */
type StoredSession = Omit<Session, "blobUrl" | "parentId" | "parentName"> & {
  teacherId?: string;
  transcript?: Turn[];
  report?: Report | null;
  diag?: unknown;
};

/**
 * Load every saved voice-quiz session from Blob (used by the Scores page and the
 * Students roster). Audio recordings (.webm/.mp4/.wav) live in the SAME prefix
 * as the session JSON, so only fetch/parse the .json files — never try to
 * JSON.parse a recording. Each parse is independently guarded so one corrupt
 * blob can't take down the page (returns null → filtered out).
 *
 * Returns SLIM records — an explicit allowlist of the fields the tables and
 * filters need (see StoredSession above); the modal-only heavy fields never
 * leave this module. `blobUrl` is attached at load time (it isn't part of the
 * saved JSON) so the owner can delete an attempt — and it's also what the
 * Details modal fetches for the full record. The stored JSON stamps the owning
 * parent under the legacy `teacherId` field name — normalized to `parentId`
 * here, so nothing above this loader sees the legacy name.
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
              const raw = (await res.json()) as StoredSession;
              const session: Session = {
                date: raw.date,
                ...(raw.track ? { track: raw.track } : {}),
                title: raw.title,
                studentName: raw.studentName,
                ...(raw.loginUser ? { loginUser: raw.loginUser } : {}),
                ...(raw.teacherId ? { parentId: raw.teacherId } : {}),
                endedAt: raw.endedAt,
                ...(raw.durationMs != null ? { durationMs: raw.durationMs } : {}),
                // Score only — the summary/strengths/gaps narrative is
                // modal-only, fetched from blobUrl on open.
                report: raw.report?.score ? { score: raw.report.score } : null,
                ...(raw.audioUrl ? { audioUrl: raw.audioUrl } : {}),
                ...(raw.partial ? { partial: raw.partial } : {}),
                ...(raw.failure ? { failure: raw.failure } : {}),
                ...(raw.cancelled ? { cancelled: raw.cancelled } : {}),
                ...(raw.inProgress ? { inProgress: raw.inProgress } : {}),
                ...(raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
                ...(raw.resumeCount ? { resumeCount: raw.resumeCount } : {}),
                blobUrl: b.url,
              };
              return session;
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
