import { currentUser, isAdmin } from "@/lib/auth";
import {
  getUser,
  rename,
  setActive,
  setPassword,
  toPublic,
  UserError,
} from "@/lib/users";

/**
 * Manage one student. Teacher-gated AND ownership-checked: the target must be a
 * student in the CALLING teacher's classroom (`teacherId === caller`). The owner
 * isn't exempt — it manages its own students only.
 *
 * PATCH { action: "rename" | "resetPassword" | "setActive", ... }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const user = await currentUser();
  if (!(await isAdmin(user))) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }

  const { username } = await params;
  const target = await getUser(username);
  if (!target || target.role !== "student" || target.teacherId !== user) {
    // Don't reveal whether the user exists in another classroom.
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }

  let body: {
    action?: string;
    displayName?: string;
    password?: string;
    active?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "rename":
        await rename(username, (body.displayName ?? "").trim());
        break;
      case "resetPassword":
        await setPassword(username, body.password ?? "");
        break;
      case "setActive":
        await setActive(username, body.active === true);
        break;
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof UserError) {
      return Response.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error("Updating student failed:", username, err);
    return Response.json({ error: "Could not update student." }, { status: 500 });
  }

  const updated = await getUser(username);
  return Response.json({ student: updated ? toPublic(updated) : null });
}
