/**
 * Score leniency for the report card.
 *
 * The grader (gpt-5.5, calibration-anchored) tends to score on the strict side,
 * so by deliberate choice we nudge every numeric score up by a fixed amount and
 * clip to 10. This is a presentation/grading-generosity decision, applied to the
 * model's score before it is saved and shown — both on the live quiz path
 * (`/api/quiz-report`) and when back-filling historical sessions, so the same
 * rule produces the same number everywhere.
 *
 * Non-numeric scores (e.g. the "—" used for a no-answers card) are passed through
 * untouched — there is nothing to be lenient about.
 */

export const SCORE_LENIENCY = 1;

/** Bump a "X/10" score by SCORE_LENIENCY, clipped to 10. Leaves "—"/unparseable scores as-is. */
export function applyLeniency(score: unknown): string {
  if (typeof score !== "string") return String(score ?? "");
  const m = score.match(/(-?\d+(?:\.\d+)?)\s*\/\s*10/);
  if (!m) return score; // "—" or anything without an "/10" — leave untouched
  // Round to one decimal so half-points stay clean (no float drift), then clip to 10.
  const bumped = Math.min(10, Math.round((parseFloat(m[1]) + SCORE_LENIENCY) * 10) / 10);
  return `${bumped}/10`;
}
