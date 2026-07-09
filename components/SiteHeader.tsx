"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AllReadingsLink from "./AllReadingsLink";
import AuthControl from "./AuthControl";
import HeaderContainer from "./HeaderContainer";

// The site-wide header bar. The home page hides it entirely: its landing
// design brings its own masthead ("READING CLUB") and its own login/scores
// controls (HomeAuthBar in the black strip), so the soft grey header would
// duplicate both — and clash. Every inner page keeps this header unchanged.
export default function SiteHeader() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <header className="border-b border-stone-200 bg-white/70 backdrop-blur">
      <HeaderContainer>
        <Link href="/" className="font-serif text-lg font-bold tracking-tight">
          Reading Club
        </Link>
        <div className="flex items-center gap-4">
          <AllReadingsLink />
          <AuthControl />
        </div>
      </HeaderContainer>
    </header>
  );
}
