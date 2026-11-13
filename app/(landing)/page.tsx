import LandingIndex from "@/components/LandingIndex";
import { homeData } from "@/lib/home";

// ISR: every level's live vote poll is rendered into the page (see
// lib/polls.ts) and re-checked at most once a minute. Publishing a reading
// redeploys, which is what closes a poll, so only an opening can be up to a
// minute late.
export const revalidate = 60;

// The home page, opened on the High School archive tab. /middle-school and
// /elementary serve the same page opened on their own tab.
export default async function Home() {
  return <LandingIndex {...await homeData(revalidate)} initial="senior" />;
}
