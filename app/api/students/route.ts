import { currentUser, isAdmin, isOwner } from "@/lib/auth";
import { createUser, getUser, UserError } from "@/lib/users";

/**
 * Create + manage students in a classroom.
 *
 * Both handlers are parent-gated. On create, a regular parent's student is
 * always placed in the CALLER's own classroom (`parentId` forced to self —
 * never trusted from the body). The OWNER is the one exception: it may pass a
 * `parentId` in the body to add a student to ANOTHER parent's classroom
 * (validated to be a real parent). Renaming / password resets still stay
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
    parentId?: string;
    teacherId?: string; // legacy alias for parentId (a stale pre-rename client)
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  // A regular parent always adds to their OWN classroom (parentId forced to
  // self). The owner may target another parent's classroom by passing a
  // `parentId` — validated to be a real parent; anyone else forging one is
  // rejected.
  let parentId = user!;
  const requested = (body.parentId ?? body.teacherId ?? "").trim().toLowerCase();
  if (requested && requested !== user) {
    if (!isOwner(user)) {
      return Response.json({ error: "Not authorized." }, { status: 403 });
    }
    const targetParent = await getUser(requested);
    if (!targetParent || targetParent.role !== "parent") {
      return Response.json({ error: "Unknown parent." }, { status: 400 });
    }
    parentId = targetParent.username;
  }

  try {
    const student = await createUser(
      {
        username: (body.username ?? "").trim().toLowerCase(),
        displayName: (body.displayName ?? "").trim(),
        password: body.password ?? "",
        role: "student",
        parentId,
      },
      user!
    );
    return Response.json({ student });
  } catch (err) {
    if (err instanceof UserError) {
      const status = err.code === "username-taken" ? 409 : 400;
      return Response.json({ error: err.message, code: err.code }, { status });
    }
    console.error("Creating student failed for parent:", user, err);
    return Response.json({ error: "Could not create student." }, { status: 500 });
  }
}
