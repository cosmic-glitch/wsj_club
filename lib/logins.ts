import { dbInsert } from "@/lib/db";
import { classroomOf, getUser } from "@/lib/users";

/**
 * The login log (rc_logins, migration 0008): one row per successful sign-in
 * with the request's IP and Vercel's edge geolocation headers. Write-only for
 * now; nothing on the site reads it.
 *
 * Never fails the sign-in: every error is logged and swallowed.
 */

function header(request: Request, name: string): string | null {
  const v = request.headers.get(name);
  if (!v) return null;
  try {
    // Vercel percent-encodes non-ASCII city names (e.g. "S%C3%A3o%20Paulo").
    return decodeURIComponent(v).slice(0, 200);
  } catch {
    return v.slice(0, 200);
  }
}

function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function recordLogin(
  request: Request,
  username: string,
  kind: "login" | "join"
): Promise<void> {
  try {
    const user = await getUser(username);
    if (!user) return;
    const ip =
      header(request, "x-real-ip") ??
      header(request, "x-forwarded-for")?.split(",")[0]?.trim() ??
      null;
    const result = await dbInsert("rc_logins", {
      username: user.username,
      parent_id: classroomOf(user),
      kind,
      ip,
      country: header(request, "x-vercel-ip-country"),
      region: header(request, "x-vercel-ip-country-region"),
      city: header(request, "x-vercel-ip-city"),
      postal_code: header(request, "x-vercel-ip-postal-code"),
      latitude: num(header(request, "x-vercel-ip-latitude")),
      longitude: num(header(request, "x-vercel-ip-longitude")),
      timezone: header(request, "x-vercel-ip-timezone"),
      user_agent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
    });
    if (result !== "ok") console.error("logins: insert failed", { user: username, kind });
  } catch (err) {
    console.error("logins: record failed", { user: username, kind }, err);
  }
}
