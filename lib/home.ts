import { getAllReadings, type Reading } from "@/lib/content";
import type { Track } from "@/lib/track";

/** Everything the home page renders: each level's readings, newest first. */
export function homeData(): { readings: Record<Track, Reading[]> } {
  return {
    readings: { senior: getAllReadings("senior"), junior: getAllReadings("junior"), kids: getAllReadings("kids") },
  };
}
