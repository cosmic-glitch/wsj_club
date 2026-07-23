"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import HeaderContainer from "./HeaderContainer";
import HomeAuthBar from "./HomeAuthBar";

// The site-wide header bar, in the brutalist language of the landing page:
// white, a thick black rule, an "RC" monogram in the Anton display face (R
// solid, C outlined — the masthead's READING/CLUB treatment, condensed), and
// the mono uppercase auth links of HomeAuthBar. Kept deliberately sparse so
// even the parent's full link set fits ONE row on a phone: the monogram IS
// the way back to the index (no separate "← All readings" link) and the
// "Hi <user>" greeting is suppressed here (showGreeting={false} — it lives on
// the landing topline instead). Should a screen still be too narrow, the
// auth-link group wraps below the monogram as one tidy unit. The home page
// hides this header entirely: its landing design brings its own masthead
// ("READING CLUB") and its own topline auth controls, so it would duplicate
// both.
export default function SiteHeader() {
  const pathname = usePathname();
  // Hidden on BOTH indexes — each landing (/ and /junior) brings its own
  // masthead + topline auth controls, so the header would duplicate them.
  if (pathname === "/" || pathname === "/junior") return null;

  // The monogram links back to the index of whichever track you're in, so a
  // junior handout's "RC" returns to /junior (not the main club).
  const homeHref = pathname?.startsWith("/junior") ? "/junior" : "/";

  return (
    <header className="border-b-2 border-[#0a0a0a] bg-white">
      <HeaderContainer>
        <Link
          href={homeHref}
          aria-label="Reading Club — all readings"
          className="-ml-1 whitespace-nowrap px-1 py-0.5 font-display text-lg font-normal uppercase leading-none tracking-[.02em] text-[#0a0a0a] hover:bg-[#ffe600]"
        >
          R
          <span className="text-transparent [-webkit-text-stroke:1.2px_#0a0a0a]">
            C
          </span>
        </Link>
        <HomeAuthBar showGreeting={false} />
      </HeaderContainer>
    </header>
  );
}
