/**
 * The reading tracks, client-safe (no fs). The ids are INTERNAL names, never
 * shown: people see TRACK_LABEL and the URL prefix from trackBase.
 *
 * - `senior` = High School, the original club. It keeps every date-keyed
 *   path bare.
 * - `junior` = Middle School (PLAN-junior.md), routes under `/middle-school`.
 * - `kids`   = Elementary (articles from kids' news sites), under `/elementary`.
 *
 * All three share ONE home page at "/"; the bare `/middle-school` and
 * `/elementary` redirect there, onto their tab (next.config.ts, levelHash).
 *
 * The site names school levels only, never grade numbers (owner's rule); the
 * grade calibration lives in the authoring skills.
 *
 * Every non-senior track keeps its id as the path segment of its stored
 * things (content files, article pages, audio, article text, glossaries, Blob
 * session keys: `trackDir`), while its public routes use the display slug
 * (`trackBase`). The old `/junior` and `/kids` URLs redirect (next.config.ts).
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

/** The public URL segment of each track's routes (senior has none). */
export const TRACK_SLUG: Record<Track, string> = {
  senior: "",
  junior: "middle-school",
  kids: "elementary",
};

/**
 * The home page's link to a level's archive tab: "/#middle-school",
 * "/#elementary", "/#high-school". The site has ONE home URL; the hash only
 * picks the tab (components/LevelTabs.tsx).
 */
export function levelHash(track: Track): string {
  return `#${TRACK_SLUG[track] || "high-school"}`;
}

/** The URL prefix of a track's routes: "" or "/middle-school" / "/elementary". */
export function trackBase(track: Track): string {
  return track === "senior" ? "" : `/${TRACK_SLUG[track]}`;
}

/** The track a site path belongs to (by its first segment; old slugs too). */
export function trackOfPath(pathname: string | null | undefined): Track {
  const seg = (pathname ?? "").split("/")[1] ?? "";
  if (seg === "middle-school" || seg === "junior") return "junior";
  if (seg === "elementary" || seg === "kids") return "kids";
  return "senior";
}

/** The display name of each track, everywhere people see one. */
export const TRACK_LABEL: Record<Track, string> = {
  senior: "High School",
  junior: "Middle School",
  kids: "Elementary",
};
