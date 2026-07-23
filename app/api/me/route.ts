import { currentUser, currentUserRecord, isAdmin, isOwner } from "@/lib/auth";

// Lets client components learn the login state (username, role, classroom, and
// whether the user is a parent/owner) without forcing the (static) pages they
// live on to render dynamically.
export async function GET() {
  // currentUser() handles the transitional env fallback, so an un-migrated user
  // still reads as logged in even though currentUserRecord() would be null.
  const username = await currentUser();
  if (!username) {
    return Response.json({
      username: null,
      displayName: null,
      role: null,
      parentId: null,
      isAdmin: false,
      isOwner: false,
    });
  }
  const record = await currentUserRecord();
  const admin = await isAdmin(username);
  return Response.json({
    username,
    displayName: record?.displayName ?? username,
    role: record?.role ?? (admin ? "parent" : "student"),
    parentId: record?.parentId ?? null,
    isAdmin: admin,
    isOwner: isOwner(username),
  });
}
