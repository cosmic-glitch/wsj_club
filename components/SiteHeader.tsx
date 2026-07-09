"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import HeaderContainer from "./HeaderContainer";
import HomeAuthBar from "./HomeAuthBar";

// The site-wide header bar, in the brutalist language of the landing page:
// white, a thick black rule, the wordmark in the Anton display face, and the
// mono uppercase auth links of HomeAuthBar. Kept deliberately sparse so it
// fits a phone: the wordmark IS the way back to the index (no separate
// "← All readings" link) and the "Hi <user>" greeting is suppressed here
// (showGreeting={false} — it lives on the landing topline instead). On a
// narrow screen the auth-link group wraps below the wordmark as one tidy
// right-aligned unit. The home page hides this header entirely: its landing
// design brings its own masthead ("READING CLUB") and its own topline auth
// controls, so it would duplicate both.
export default function SiteHeader() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <header className="border-b-[3px] border-[#0a0a0a] bg-white">
      <HeaderContainer>
        <Link
          href="/"
          className="whitespace-nowrap font-display text-xl font-normal uppercase leading-none tracking-[.02em] text-[#0a0a0a] hover:bg-[#ffe600]"
        >
          Reading{" "}
          <span className="text-transparent [-webkit-text-stroke:1.2px_#0a0a0a]">
            Club
          </span>
        </Link>
        <HomeAuthBar showGreeting={false} />
      </HeaderContainer>
    </header>
  );
}
