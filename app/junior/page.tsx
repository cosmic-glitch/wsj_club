import LandingIndex from "@/components/LandingIndex";
import { getAllReadings } from "@/lib/content";

export const metadata = {
  title: "Junior · Daily Reading Club",
  description:
    "The Junior Reading Club (US grades 5–7) — a daily-ish news handout with vocabulary, concepts, and a self-quiz.",
};

// The junior index. Thin wrapper over the shared LandingIndex with the junior
// readings and track="junior" (which supplies the "Junior · Grades 5–7" masthead
// label, the "← Main club" cross-link, and the /junior prefix on each row's
// Handout / AI Quiz actions). Renders the empty state until the first junior
// reading is published (getAllReadings("junior") returns [] while content/junior/
// doesn't exist).
export default function JuniorHome() {
  return <LandingIndex readings={getAllReadings("junior")} track="junior" />;
}
