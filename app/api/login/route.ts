import { verifyCredentials, setSessionCookie } from "@/lib/auth";

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
  return Response.json({ ok: true, username });
}
