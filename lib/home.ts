import { getAllReadings, type Reading } from "@/lib/content";
import { publicPoll, type PublicPoll } from "@/lib/polls";
import { TRACKS, type Track } from "@/lib/track";

/**
 * Everything the home page renders, for all three levels: each level's
 * readings (newest first) and its live vote poll. Shared by the three URLs
 * that serve the home page ("/", "/middle-school", "/elementary").
 * `revalidate` is the page's ISR window (see lib/polls.ts publicPoll).
 */
export async function homeData(revalidate: number): Promise<{
  readings: Record<Track, Reading[]>;
  polls: Record<Track, PublicPoll | null>;
}> {
  const polls = await Promise.all(TRACKS.map((t) => publicPoll(t, revalidate)));
  return {
    readings: { senior: getAllReadings("senior"), junior: getAllReadings("junior"), kids: getAllReadings("kids") },
    polls: { senior: polls[0], junior: polls[1], kids: polls[2] },
  };
}
