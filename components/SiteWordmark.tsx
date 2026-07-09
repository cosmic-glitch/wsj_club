"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The small "Reading Club" wordmark in the global header. The home page
// renders its own giant "READING CLUB" masthead right below the header, so
// the little wordmark there read as a weird duplicate — hide it on "/" (the
// header then shows just the right-aligned login/scores controls, playing the
// role of the design's thin topline) and show it on every other page.
export default function SiteWordmark() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <Link href="/" className="font-serif text-lg font-bold tracking-tight">
      Reading Club
    </Link>
  );
}
