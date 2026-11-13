"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import HeaderContainer from "./HeaderContainer";
import HomeAuthBar from "./HomeAuthBar";
import { TRACKS, TRACK_LABEL, trackBase, trackOfPath, type Track } from "@/lib/track";

/** The level a page belongs to, or null for level-less pages (Guide, admin). */
function levelOfPath(pathname: string | null): Track | null {
  const seg = (pathname ?? "").split("/")[1] ?? "";
  if (seg === "reading" || seg === "words") return "senior";
  if (["middle-school", "junior", "elementary", "kids"].includes(seg)) return trackOfPath(pathname);
  return null;
}

// The site-wide header bar, in the brutalist language of the landing page:
// white, a thick black rule, an "RC" monogram in the Anton display face (R
// solid, C outlined — the masthead's READING/CLUB treatment, condensed), and
// the mono uppercase auth links of HomeAuthBar — greeting included, so the
// bar reads IDENTICALLY to the landing topline and never jitters between
// pages (it used to suppress "Hi <user>" here, which made the greeting vanish
// and the links shift on every inner page). The monogram IS the way back to
// the index (no separate "← All readings" link). Should a screen be too
// narrow, the auth-link group wraps below the monogram as one tidy unit
// (and the greeting may wrap on its own — see HomeAuthBar). A second thin row
// lists the three levels. The home page
// never mounts this header (they live in the app/(landing) route group, which
// has no SiteHeader): their landing design brings its own masthead ("READING
// CLUB") and its own topline auth controls, so it would duplicate both.
export default function SiteHeader() {
  const pathname = usePathname();

  // The monogram links back to the index of whichever track you're in, so a
  // middle-school handout's "RC" opens the home page on its own tab.
  const homeHref = trackBase(trackOfPath(pathname)) || "/";
  const level = levelOfPath(pathname);

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
        <HomeAuthBar />
      </HeaderContainer>
      {/* The levels, on every page: each opens the home page on that level's
          archive tab; the current page's level is inverted. */}
      <nav aria-label="Levels" className="border-t border-[#0a0a0a]/15">
        <HeaderContainer>
          <div className="-ml-1.5 flex flex-wrap gap-x-1">
            {TRACKS.map((t) => (
              <Link
                key={t}
                href={trackBase(t) || "/"}
                aria-current={level === t ? "page" : undefined}
                className={`px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[.12em] no-underline ${
                  level === t
                    ? "bg-[#0a0a0a] text-[#ffe600]"
                    : "text-stone-500 hover:bg-[#0a0a0a] hover:text-[#ffe600]"
                }`}
              >
                {TRACK_LABEL[t]}
              </Link>
            ))}
          </div>
        </HeaderContainer>
      </nav>
    </header>
  );
}
