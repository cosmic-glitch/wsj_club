import { getOwnerUsers, setSessionCookie } from "@/lib/auth";
import { createUser, getUser, UserError } from "@/lib/users";

/**
 * Self-serve signup — the topline "Join" button (no login required).
 *
 * Two shapes, both created in one submit and logged in on success (the session
 * cookie is set for the NEW account — the parent, in the family shape):
 *
 *   { role: "student", username, password, email? }
 *       → a student account. A self-joining student has no parent on the site,
 *         so they land in the OWNER's classroom — resolved from OWNER_USERS
 *         server-side, never trusted from the body.
 *   { role: "parent", username, password, email?, children: [{username, password}, …] }
 *       → a parent account plus a student login per child.
 *
 * No display name is collected (display name = username), and email is
 * optional — stored only for future password recovery.
 */

const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;
const MIN_PASSWORD = 6;
const MAX_CHILDREN = 8;

// GET /api/join?username=<x> → { available } — the form's live username check.
// Public by design: the same fact leaks from a signup attempt anyway.
export async function GET(request: Request) {
  const username = (new URL(request.url).searchParams.get("username") ?? "")
    .trim()
    .toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return Response.json({ available: false, reason: "invalid" });
  }
  const existing = await getUser(username);
  return Response.json({ available: !existing });
}

type Credentials = { username: string; password: string };

/** Normalize + validate one username/password pair; returns an error string or null. */
function checkCredentials(c: Credentials, label: string): string | null {
  if (!USERNAME_RE.test(c.username)) {
    return `${label}: username must be 3–32 characters — lowercase letters, numbers, - or _.`;
  }
  if (c.password.length < MIN_PASSWORD) {
    return `${label}: the password needs at least ${MIN_PASSWORD} characters.`;
  }
  return null;
}

/** The owner's account (from OWNER_USERS) that adopts self-joining students. */
async function resolveOwnerParent(): Promise<string | null> {
  for (const name of getOwnerUsers()) {
    const u = await getUser(name);
    if (u && u.role === "parent" && u.active !== false) return u.username;
  }
  return null;
}

/**
 * createUser, but if the write fails outright and an email was included, retry
 * once without it — pre-migration (no email column yet) a typed email must
 * degrade to a joined account, never a failed one. The drop is logged.
 */
async function createUserTolerant(
  input: Parameters<typeof createUser>[0],
  createdBy: string
): Promise<void> {
  try {
    await createUser(input, createdBy);
  } catch (err) {
    if (err instanceof UserError || !input.email) throw err;
    console.error(
      `Join: retrying ${input.username} without email (had: ${input.email})`,
      err
    );
    await createUser({ ...input, email: undefined }, createdBy);
  }
}

export async function POST(request: Request) {
  let body: {
    role?: string;
    username?: string;
    password?: string;
    email?: string;
    children?: { username?: string; password?: string }[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const role = body.role === "parent" ? "parent" : "student";
  const self: Credentials = {
    username: (body.username ?? "").trim().toLowerCase(),
    password: body.password ?? "",
  };
  const email = (body.email ?? "").trim() || undefined;

  const selfError = checkCredentials(self, role === "parent" ? "Your login" : "Username");
  if (selfError) return Response.json({ error: selfError }, { status: 400 });

  // ---------------------------------------------------------------- student
  if (role === "student") {
    const parentId = await resolveOwnerParent();
    if (!parentId) {
      return Response.json(
        { error: "Student signups aren't open right now — ask the club owner for a login." },
        { status: 503 }
      );
    }
    try {
      await createUserTolerant(
        { ...self, role: "student", parentId, email },
        "self-signup"
      );
    } catch (err) {
      if (err instanceof UserError) {
        const status = err.code === "username-taken" ? 409 : 400;
        return Response.json({ error: err.message, code: err.code }, { status });
      }
      console.error("Join (student) failed:", self.username, err);
      return Response.json({ error: "Could not create your account." }, { status: 500 });
    }
    await setSessionCookie(self.username);
    return Response.json({ ok: true, username: self.username, role });
  }

  // ----------------------------------------------------------------- parent
  const children: Credentials[] = (Array.isArray(body.children) ? body.children : []).map(
    (c) => ({
      username: (c?.username ?? "").trim().toLowerCase(),
      password: c?.password ?? "",
    })
  );
  if (children.length < 1) {
    return Response.json(
      { error: "Add at least one child — a parent account exists to manage students." },
      { status: 400 }
    );
  }
  if (children.length > MAX_CHILDREN) {
    return Response.json(
      { error: `That's a lot of kids — at most ${MAX_CHILDREN} per signup.` },
      { status: 400 }
    );
  }
  for (let i = 0; i < children.length; i++) {
    const err = checkCredentials(children[i], `Child ${i + 1}`);
    if (err) return Response.json({ error: err }, { status: 400 });
  }
  const names = [self.username, ...children.map((c) => c.username)];
  if (new Set(names).size !== names.length) {
    return Response.json(
      { error: "Each person needs their own username — you've repeated one." },
      { status: 400 }
    );
  }
  // Pre-check every username so a taken one fails the whole submit BEFORE any
  // account exists (the per-insert conflict check still backstops races).
  for (const name of names) {
    if (await getUser(name)) {
      return Response.json(
        { error: `The username "${name}" is already taken.`, code: "username-taken" },
        { status: 409 }
      );
    }
  }

  try {
    await createUserTolerant({ ...self, role: "parent", email }, "self-signup");
  } catch (err) {
    if (err instanceof UserError) {
      const status = err.code === "username-taken" ? 409 : 400;
      return Response.json({ error: err.message, code: err.code }, { status });
    }
    console.error("Join (parent) failed:", self.username, err);
    return Response.json({ error: "Could not create your account." }, { status: 500 });
  }
  // The parent exists — log them in now, so even a failed child below leaves
  // them able to finish from the Students page.
  await setSessionCookie(self.username);

  const created: string[] = [];
  for (const child of children) {
    try {
      await createUser(
        { ...child, role: "student", parentId: self.username },
        self.username
      );
      created.push(child.username);
    } catch (err) {
      console.error("Join: child creation failed:", child.username, err);
      const detail =
        err instanceof UserError && err.code === "username-taken"
          ? `the username "${child.username}" was just taken`
          : `creating "${child.username}" failed`;
      return Response.json(
        {
          error: `Your parent account was created and you're logged in, but ${detail}. Add that student from the Students page.`,
          created,
        },
        { status: err instanceof UserError ? 409 : 500 }
      );
    }
  }

  return Response.json({ ok: true, username: self.username, role, children: created });
}
