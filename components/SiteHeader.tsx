"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AllReadingsLink from "./AllReadingsLink";
import HeaderContainer from "./HeaderContainer";
import HomeAuthBar from "./HomeAuthBar";

// The site-wide header bar, in the brutalist language of the landing page:
// white, a thick black rule, the wordmark in the Anton display face, and the
// mono uppercase text links of HomeAuthBar (the same auth control the landing
// topline uses). The home page hides it entirely: its landing design brings
// its own masthead ("READING CLUB") and its own topline auth controls, so this
// header would duplicate both.
export default function SiteHeader() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <header className="border-b-[3px] border-[#0a0a0a] bg-white">
      <HeaderContainer>
        <Link
          href="/"
          className="font-display text-xl font-normal uppercase leading-none tracking-[.02em] text-[#0a0a0a] hover:bg-[#ffe600]"
        >
          Reading{" "}
          <span className="text-transparent [-webkit-text-stroke:1.2px_#0a0a0a]">
            Club
          </span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          <AllReadingsLink />
          <HomeAuthBar />
        </div>
      </HeaderContainer>
    </header>
  );
}
