import LandingIndex from "@/components/LandingIndex";
import { getAllReadings } from "@/lib/content";
import { publicPoll } from "@/lib/polls";

// ISR: the live vote poll is rendered into the page (see lib/polls.ts) and
// re-checked at most once a minute. Publishing a reading redeploys, which is
// what closes a poll, so only an opening can be up to a minute late.
export const revalidate = 60;

export default async function Home() {
  return (
    <LandingIndex
      readings={getAllReadings()}
      track="senior"
      poll={await publicPoll("senior", revalidate)}
    />
  );
}
