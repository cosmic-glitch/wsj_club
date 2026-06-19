"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The "← All readings" link is redundant on the home page (which *is* the list
// of all readings), so hide it there and show it on every other page.
export default function AllReadingsLink() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <Link
      href="/"
      className="text-sm text-stone-500 transition hover:text-stone-900"
    >
      ← All readings
    </Link>
  );
}
