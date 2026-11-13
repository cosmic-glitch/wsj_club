import LandingIndex from "@/components/LandingIndex";
import { getAllReadings } from "@/lib/content";
import { publicPoll } from "@/lib/polls";

// ISR for the server-rendered vote row — the same window as the other indexes.
export const revalidate = 60;

export const metadata = {
  title: "Elementary · Daily Reading Club",
  description:
    "The Daily Reading Club for elementary schoolers: an article from a kids' news site with vocabulary, a concept, and a self-quiz.",
  // Not linked from the other indexes yet: keep it out of search.
  robots: { index: false },
};

// The elementary index (track id "kids", lib/track.ts). Thin wrapper over the
// shared LandingIndex, like the middle-school one.
export default async function ElementaryHome() {
  return (
    <LandingIndex
      readings={getAllReadings("kids")}
      track="kids"
      poll={await publicPoll("kids", revalidate)}
    />
  );
}
