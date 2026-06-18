import { currentUser } from "@/lib/auth";

// Lets client components learn the login state without forcing the (static)
// pages they live on to render dynamically.
export async function GET() {
  const username = await currentUser();
  return Response.json({ username });
}
