import LandingIndex from "@/components/LandingIndex";
import { homeData } from "@/lib/home";

// ISR for the server-rendered vote rows — the same window as "/".
export const revalidate = 60;

export const metadata = {
  title: "Elementary · Daily Reading Club",
  description:
    "The Daily Reading Club for elementary schoolers: an article from a kids' news site with vocabulary, a concept, and a self-quiz.",
};

// The home page (every level), opened on the Elementary archive tab.
export default async function ElementaryHome() {
  return <LandingIndex {...await homeData(revalidate)} initial="kids" />;
}
