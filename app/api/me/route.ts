import { currentUser, isAdmin } from "@/lib/auth";

// Lets client components learn the login state (and whether the user is a
// teacher/admin) without forcing the (static) pages they live on to render
// dynamically.
export async function GET() {
  const username = await currentUser();
  return Response.json({ username, isAdmin: isAdmin(username) });
}
