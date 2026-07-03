import { currentUser, isAdmin } from "@/lib/auth";
import { createUser, getUser, UserError } from "@/lib/users";

/**
 * Create + manage students in a teacher's own classroom.
 *
 * Both handlers are teacher-gated. On create, the student's `teacherId` is
 * FORCED to the authenticated caller server-side (never read from the body), so
 * a teacher can only ever add to their own classroom.
 */

const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

// GET /api/students?username=<x> → { available: boolean, reason?: string }
// A lightweight uniqueness check for the Add-student form's live hint.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!(await isAdmin(user))) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }
  const username = (new URL(request.url).searchParams.get("username") ?? "")
    .trim()
    .toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return Response.json({ available: false, reason: "invalid" });
  }
  const existing = await getUser(username);
  return Response.json({ available: !existing });
}

// POST /api/students { displayName, username, password } → { student }
export async function POST(request: Request) {
  const user = await currentUser();
  if (!(await isAdmin(user))) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }

  let body: { displayName?: string; username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const student = await createUser(
      {
        username: (body.username ?? "").trim().toLowerCase(),
        displayName: (body.displayName ?? "").trim(),
        password: body.password ?? "",
        role: "student",
        teacherId: user!, // forced to the caller — never trust the body
      },
      user!
    );
    return Response.json({ student });
  } catch (err) {
    if (err instanceof UserError) {
      const status = err.code === "username-taken" ? 409 : 400;
      return Response.json({ error: err.message, code: err.code }, { status });
    }
    console.error("Creating student failed for teacher:", user, err);
    return Response.json({ error: "Could not create student." }, { status: 500 });
  }
}
