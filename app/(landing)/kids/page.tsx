import LandingIndex from "@/components/LandingIndex";
import { getAllReadings } from "@/lib/content";

export const metadata = {
  title: "Kids · Daily Reading Club",
  description:
    "The Kids Reading Club (early readers, about a grade 3 reading level): an article from a kids' news site with vocabulary, a concept, and a self-quiz.",
  // Experimental and unlinked from the rest of the site: keep it out of search.
  robots: { index: false },
};

// The EXPERIMENTAL kids index (lib/track.ts). Thin wrapper over the shared
// LandingIndex with track="kids": the "Kids · Grades 2–4" masthead label, the
// "← Main club" link, and the /kids prefix on each row's actions. No vote on
// this track, so no poll (LandingIndex skips the vote row for kids) and no ISR.
export default function KidsHome() {
  return <LandingIndex readings={getAllReadings("kids")} track="kids" poll={null} />;
}
