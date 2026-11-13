import LandingIndex from "@/components/LandingIndex";
import { getAllReadings } from "@/lib/content";
import { publicPoll } from "@/lib/polls";

// ISR for the server-rendered vote row — the same window as the senior index.
export const revalidate = 60;

export const metadata = {
  title: "Middle School · Daily Reading Club",
  description:
    "The Daily Reading Club for middle schoolers (US grades 5–7) — a daily-ish news handout with vocabulary, concepts, and a self-quiz.",
};

// The middle-school index (track id "junior", lib/track.ts). Thin wrapper over
// the shared LandingIndex, which supplies the masthead label, the cross-link,
// and the /middle-school prefix on each row's actions.
export default async function MiddleSchoolHome() {
  return (
    <LandingIndex
      readings={getAllReadings("junior")}
      track="junior"
      poll={await publicPoll("junior", revalidate)}
    />
  );
}
