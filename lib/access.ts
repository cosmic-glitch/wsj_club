import { after } from "next/server";
import { dbInsert, dbRpc } from "@/lib/db";
import { classroomOf, getUser, type User } from "@/lib/users";

/**
 * Where members use the site from. Two write-only stores, nothing on the site
 * reads them yet:
 *
 *  - rc_logins (migration 0008): one row per successful sign-in (password
 *    login, or the auto-login after a Join).
 *  - rc_access (migration 0009): one row per (member, Pacific day, IP) with
 *    first/last access and a request count, touched from /api/me (every page
 *    load's login bar) and /api/events (the article pages' beacon).
 *
 * The location is Vercel's edge geolocation headers (approximate, IP-based;
 * absent on a local `npm run dev`). Nothing here ever fails the request it
 * rides on: errors are logged and swallowed, and the access touch runs after
 * the response.
 */

type Origin = {
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  user_agent: string | null;
};

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

/** Read the request's IP + geolocation now (before any `after`). */
function originOf(request: Request): Origin {
  return {
    ip:
      header(request, "x-real-ip") ??
      header(request, "x-forwarded-for")?.split(",")[0]?.trim() ??
      null,
    country: header(request, "x-vercel-ip-country"),
    region: header(request, "x-vercel-ip-country-region"),
    city: header(request, "x-vercel-ip-city"),
    postal_code: header(request, "x-vercel-ip-postal-code"),
    latitude: num(header(request, "x-vercel-ip-latitude")),
    longitude: num(header(request, "x-vercel-ip-longitude")),
    timezone: header(request, "x-vercel-ip-timezone"),
    user_agent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
  };
}

/** Append a sign-in row. Awaited by the login/join routes; never throws. */
export async function recordLogin(
  request: Request,
  username: string,
  kind: "login" | "join"
): Promise<void> {
  try {
    const user = await getUser(username);
    if (!user) return;
    const result = await dbInsert("rc_logins", {
      username: user.username,
      parent_id: classroomOf(user),
      kind,
      ...originOf(request),
    });
    if (result !== "ok") console.error("logins: insert failed", { user: username, kind });
  } catch (err) {
    console.error("logins: record failed", { user: username, kind }, err);
  }
}

/** Bump today's access row for this member + IP, after the response is sent. */
export function touchAccess(
  request: Request,
  user: Pick<User, "username" | "role" | "parentId">
): void {
  const origin = originOf(request);
  const row = { username: user.username, parent_id: classroomOf(user), ...origin };
  after(async () => {
    try {
      const ok = await dbRpc("rc_touch_access", { p: row });
      if (!ok) console.error("access: touch failed", { user: user.username });
    } catch (err) {
      console.error("access: touch failed", { user: user.username }, err);
    }
  });
}
