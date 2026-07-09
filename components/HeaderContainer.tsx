"use client";

import { usePathname } from "next/navigation";

/**
 * The header's inner width. Everywhere on the site the header sits in the same
 * `max-w-3xl` column as the page content, so its "Reading Club" logo lines up
 * with whatever is below it. The admin routes (Scores + Manage Students) are the
 * exception: their data tables break out to a wider `max-w-4xl` column (see
 * `app/admin/layout.tsx`), so a `max-w-3xl` header left the logo ~84px to the
 * right of the table's left edge.
 *
 * On `/admin*` we widen the header to match that column. The admin content is a
 * centered 896px (`max-w-4xl`) block with no inner padding; a header of
 * `max-w-[936px]` (896 + the header's own 2×20px `px-5`) centers to the exact
 * same content box, so the logo's left edge — and the right-hand controls — line
 * up with the table on both sides.
 */
export default function HeaderContainer({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const wide = pathname?.startsWith("/admin");
  // On the home page the wordmark is hidden (see SiteWordmark) and only the
  // login/scores controls remain — keep them on the right, like a topline.
  const home = pathname === "/";

  return (
    <div
      className={`mx-auto flex items-center px-5 py-4 ${
        home ? "justify-end" : "justify-between"
      } ${wide ? "max-w-[936px]" : "max-w-3xl"}`}
    >
      {children}
    </div>
  );
}
