import { currentUser, isAdmin, isOwner } from "@/lib/auth";
import { createUser, getUser, UserError } from "@/lib/users";

/**
 * Create + manage students in a classroom.
 *
 * Both handlers are teacher-gated. On create, a regular teacher's student is
 * always placed in the CALLER's own classroom (`teacherId` forced to self —
 * never trusted from the body). The OWNER is the one exception: it may pass a
 * `teacherId` in the body to add a student to ANOTHER teacher's classroom
 * (validated to be a real teacher). Renaming / password resets still stay
 * own-classroom for everyone (see `[username]/route.ts`).
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

  let body: {
    displayName?: string;
    username?: string;
    password?: string;
    teacherId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  // A regular teacher always adds to their OWN classroom (teacherId forced to
  // self). The owner may target another teacher's classroom by passing a
  // `teacherId` — validated to be a real teacher; anyone else forging one is
  // rejected.
  let teacherId = user!;
  const requested = (body.teacherId ?? "").trim().toLowerCase();
  if (requested && requested !== user) {
    if (!isOwner(user)) {
      return Response.json({ error: "Not authorized." }, { status: 403 });
    }
    const targetTeacher = await getUser(requested);
    if (!targetTeacher || targetTeacher.role !== "teacher") {
      return Response.json({ error: "Unknown teacher." }, { status: 400 });
    }
    teacherId = targetTeacher.username;
  }

  try {
    const student = await createUser(
      {
        username: (body.username ?? "").trim().toLowerCase(),
        displayName: (body.displayName ?? "").trim(),
        password: body.password ?? "",
        role: "student",
        teacherId,
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
