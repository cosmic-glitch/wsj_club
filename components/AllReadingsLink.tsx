"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The "← All readings" link is redundant on the home page (which *is* the list
// of all readings), so hide it there and show it on every other page. Styled
// like the header's other mono text links (see HomeAuthBar's `bar`).
export default function AllReadingsLink() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <Link
      href="/"
      className="inline-block px-1.5 py-1 font-mono text-[11px] font-bold uppercase leading-normal tracking-[.12em] text-[#0a0a0a] no-underline hover:bg-[#0a0a0a] hover:text-[#ffe600]"
    >
      ← All readings
    </Link>
  );
}
