/**
 * The reading tracks, client-safe (no fs). `senior` (US grades 8–10) is the
 * original club and keeps every date-keyed path bare; every other track lives
 * under its own path segment everywhere: content files, article pages, audio,
 * article text, Blob session keys, and its routes (`/junior`, `/kids`).
 *
 * - `junior`: US grades 5–7 (PLAN-junior.md).
 * - `kids`: an EXPERIMENTAL early-elementary track (reading at about a grade 3
 *   level), sourced from kids' news sites. Unlinked from the rest of the site;
 *   reachable only at /kids.
 *
 * A day is identified by (track, date): dates repeat across tracks.
 */
export const TRACKS = ["senior", "junior", "kids"] as const;
export type Track = (typeof TRACKS)[number];
/** Every track but senior — the ones that carry a path segment and a badge. */
export type SubTrack = Exclude<Track, "senior">;

/**
 * Parse an untrusted value (request body, query param, DB row) into a track,
 * defaulting to senior. The ONE place a track string is validated.
 */
export function parseTrack(v: unknown): Track {
  return v === "junior" || v === "kids" ? v : "senior";
}

/** A stored track as the optional record stamp: absent means senior. */
export function subTrackOf(v: unknown): SubTrack | undefined {
  const t = parseTrack(v);
  return t === "senior" ? undefined : t;
}

/** The path segment a track's files / Blob keys sit under: "" or "junior/" / "kids/". */
export function trackDir(track: Track): string {
  return track === "senior" ? "" : `${track}/`;
}

/** The URL prefix of a track's routes: "" or "/junior" / "/kids". */
export function trackBase(track: Track): string {
  return track === "senior" ? "" : `/${track}`;
}

/** The track a site path belongs to (by its first segment). */
export function trackOfPath(pathname: string | null | undefined): Track {
  if (!pathname) return "senior";
  if (pathname === "/junior" || pathname.startsWith("/junior/")) return "junior";
  if (pathname === "/kids" || pathname.startsWith("/kids/")) return "kids";
  return "senior";
}

/** Owner-facing track names (Reports tabs, Activity tables). */
export const TRACK_LABEL: Record<Track, string> = {
  senior: "Regular",
  junior: "Junior",
  kids: "Kids",
};

/** The index masthead's grade label (none on the senior index). */
export const TRACK_BAND: Record<Track, string> = {
  senior: "Grades 8–10",
  junior: "Grades 5–7",
  kids: "Grades 2–4",
};
