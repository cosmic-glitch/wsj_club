import LandingIndex from "@/components/LandingIndex";
import { homeData } from "@/lib/home";

// ISR for the server-rendered vote rows — the same window as "/".
export const revalidate = 60;

export const metadata = {
  title: "Middle School · Daily Reading Club",
  description:
    "The Daily Reading Club for middle schoolers — a daily news handout with vocabulary, concepts, and a self-quiz.",
};

// The home page (every level), opened on the Middle School archive tab.
export default async function MiddleSchoolHome() {
  return <LandingIndex {...await homeData(revalidate)} initial="junior" />;
}
