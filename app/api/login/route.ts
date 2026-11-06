import { verifyCredentials, setSessionCookie } from "@/lib/auth";
import { recordLogin } from "@/lib/logins";

export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  if (!(await verifyCredentials(username, password))) {
    return Response.json({ error: "Wrong username or password" }, { status: 401 });
  }

  await setSessionCookie(username);
  await recordLogin(request, username, "login");
  return Response.json({ ok: true, username });
}
