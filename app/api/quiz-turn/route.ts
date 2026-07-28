import { currentUser } from "@/lib/auth";
import { getReading, type Track } from "@/lib/content";
import { getArticleText } from "@/lib/article-text";
import { buildInstructions } from "@/lib/quiz-prompt";

// The chat model that plays the tutor, turn by turn — same model as the grader
// (REPORT_MODEL). Env-overridable, but do NOT drop this to a mini/nano tier to
// save money: the whole stage plan below (key ideas → vocabulary → concepts →
// wrap-up) is honour-system, since nothing here validates `done` against the
// stages actually covered. gpt-5.4-mini set `done: true` at the vocabulary →
// concept boundary in half of all sessions (16/32 on replayed decision points;
// 44% of graded sessions never met the two-concept quota), silently ending the
// quiz before any concept was asked. luna was 0/32 on the same replays. The
// cost gap is ~$0.004 per quiz — not worth a skipped concept stage.
const TUTOR_MODEL = process.env.TUTOR_MODEL || "gpt-5.6-luna";

// The exact wrap-up sentence the tutor is instructed to end with. It doubles as a
// backup "the quiz is done" signal: if the model's reply isn't valid JSON (or it
// forgets the `done` flag), the presence of this phrase in the spoken line still
// marks the quiz complete. Keep it in sync with buildInstructions in lib/quiz-prompt.ts.
const WRAP_UP_PHRASE = "The quiz is done. You can press the End Quiz button.";

type Turn = { role: "student" | "tutor"; text: string };

// Return the FIRST balanced {...} object in `content`, honoring strings/escapes so
// braces inside "text" don't fool the brace counter. The model is asked for one
// JSON object, but it occasionally emits TWO back-to-back (or wraps the object in
// stray prose); a plain JSON.parse of the whole string then throws on the trailing
// data and the raw JSON leaks out as the spoken line. Pulling the first object out
// lets us parse just that. Returns null if there's no complete object.
function firstJsonObject(content: string): string | null {
  const start = content.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return content.slice(start, i + 1);
  }
  return null;
}

// Parse one tutor reply into the spoken line + the done flag. The model is asked
// to return {"text","done"} JSON (response_format json_object), but we stay
// defensive: parse the FIRST balanced {...} object (so a doubled/prose-wrapped
// emission still yields clean text); if nothing parses we treat the raw content as
// the spoken line, and either way the exact wrap-up phrase is a backup signal for done.
function parseTutorReply(content: string): { text: string; done: boolean } {
  let text = content.trim();
  let done = false;
  const candidate = firstJsonObject(content) ?? content;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object") {
      // Valid JSON but no usable "text" field → treat it as an empty completion
      // (the caller retries once, then 502s) rather than letting the raw JSON
      // blob become the spoken/displayed line.
      text = typeof parsed.text === "string" ? parsed.text.trim() : "";
      done = parsed.done === true;
    }
  } catch {
    // Not JSON — fall back to the raw content as the spoken line.
  }
  if (!done && text.includes(WRAP_UP_PHRASE)) done = true;
  return { text, done };
}

/**
 * The turn-by-turn brain of the voice quiz. Given the running transcript so far,
 * it returns the tutor's NEXT spoken line (a question, a follow-up, or the
 * wrap-up). The browser speaks it with TTS, records the student's answer,
 * transcribes it, appends both turns, and calls this again — a discrete loop
 * that replaced the old realtime speech-to-speech session, so turn-taking is
 * fully under the student's control (Start/Stop buttons), never the model's.
 *
 * Login-gated, and the real OpenAI key never reaches the browser. The day's full
 * article text + handout answer key are injected as the system prompt (the same
 * `buildInstructions` the realtime session used), so the tutor judges answers
 * against the real story.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Please log in to start a quiz." }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Server is missing OPENAI_API_KEY." }, { status: 500 });
  }

  let body: { date?: string; studentName?: string; transcript?: Turn[]; track?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const date = (body.date ?? "").trim();
  // `track` is a label the page knows (senior vs junior), not an identity claim —
  // safe to take from the client (a forged track only reaches the caller's own
  // junior path; identity still comes from the cookie). Default senior.
  const track: Track = body.track === "junior" ? "junior" : "senior";
  const studentName = (body.studentName ?? "").trim() || user;
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const reading = getReading(date, track);
  if (!reading) {
    return Response.json({ error: "Unknown reading." }, { status: 404 });
  }

  const articleText = await getArticleText(date, track);
  const instructions = buildInstructions(reading, studentName, articleText, track);

  // The tutor's instructions are the system prompt; the running transcript maps
  // into chat turns (tutor → assistant, student → user). On the very first call
  // the transcript is empty, so a tiny kickoff message asks for the greeting +
  // first question.
  const messages: { role: "system" | "assistant" | "user"; content: string }[] = [
    { role: "system", content: instructions },
  ];
  for (const t of transcript) {
    if (t.text?.trim()) {
      messages.push({ role: t.role === "tutor" ? "assistant" : "user", content: t.text });
    }
  }
  if (messages.length === 1) {
    messages.push({
      role: "user",
      content: "[The student just started the quiz. Greet them and ask your first question now.]",
    });
  }

  try {
    // The `done` flag is what gates the client's "End quiz" button, so an empty
    // completion (a transient OpenAI hiccup — finish_reason "stop" with blank
    // content) must not end the quiz prematurely: retry the request once before
    // giving up with a 502.
    let reply: { text: string; done: boolean } | null = null;
    for (let attempt = 0; attempt < 2 && !reply; attempt++) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: TUTOR_MODEL,
          response_format: { type: "json_object" },
          messages,
        }),
      });
      if (!res.ok) {
        console.error(
          "Tutor turn failed:",
          res.status,
          "user:",
          user,
          "turns:",
          transcript.length,
          "attempt:",
          attempt,
          await res.text()
        );
        return Response.json({ error: "Could not get the next question." }, { status: 502 });
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      const parsed = parseTutorReply(content);
      if (parsed.text) {
        reply = parsed;
      } else {
        console.error(
          "Tutor turn: empty response for user:",
          user,
          "turns:",
          transcript.length,
          "attempt:",
          attempt,
          data
        );
        // Loop retries once on an empty completion before we 502.
      }
    }
    if (!reply) {
      return Response.json({ error: "Could not get the next question." }, { status: 502 });
    }
    return Response.json({ text: reply.text, done: reply.done });
  } catch (err) {
    console.error("Tutor turn error for user:", user, "turns:", transcript.length, err);
    return Response.json({ error: "Could not get the next question." }, { status: 502 });
  }
}
