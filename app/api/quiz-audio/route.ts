import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { currentUser } from "@/lib/auth";
import { getReading } from "@/lib/content";

/**
 * Issues a short-lived, auth-gated token so the browser can upload a finished
 * voice-quiz recording DIRECTLY to Vercel Blob (the `@vercel/blob` client
 * `upload()` flow). The audio bytes never pass through this function, so we
 * sidestep the serverless request-body limit (~4.5MB) that was returning 413
 * for full-length recordings when the file was POSTed through the route. The
 * client attaches the returned blob URL to the session via /api/quiz-report.
 * Best-effort, like the rest of the save path.
 */
export async function POST(request: Request): Promise<Response> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const json = await handleUpload({
      body,
      request,
      // Gate token generation on a valid login + a known reading, and pin the
      // upload to this day's session folder. (The check lives HERE, not at the
      // top of POST, because Vercel Blob's separate upload-completed callback is
      // unauthenticated by design — guarding the whole route would 401 it.)
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const user = await currentUser();
        if (!user) throw new Error("Not logged in.");
        let date = "";
        try {
          date = (JSON.parse(clientPayload ?? "{}").date ?? "").trim();
        } catch {
          // no / invalid payload → date stays empty → rejected below
        }
        if (!getReading(date)) throw new Error("Unknown reading.");
        if (!pathname.startsWith(`quiz-sessions/${date}/`)) {
          throw new Error("Unexpected upload path.");
        }
        return {
          allowedContentTypes: ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"],
          addRandomSuffix: true,
          maximumSizeInBytes: 50 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do server-side — the client links the returned URL onto the
        // session via /api/quiz-report. (This webhook isn't reachable on
        // localhost, which is fine: the upload still succeeds and the client
        // still gets the URL.)
      },
    });
    return Response.json(json);
  } catch (err) {
    console.error("Quiz-audio client upload token failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 400 }
    );
  }
}
