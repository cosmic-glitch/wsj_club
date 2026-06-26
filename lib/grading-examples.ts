/**
 * Calibration examples for the report-card grader (`buildReportPrompt`).
 *
 * The standalone grader, judging each transcript in isolation against the
 * article, tends to (a) compress every score into the 8–9 band, (b) reward a
 * long, detail-packed transcript over a tighter one that actually covers the
 * harder ideas, and (c) drift day to day, since "what a 7 vs a 9 means" is
 * re-invented on every call. These are a few worked, EXPERT-REVISED examples —
 * drawn from real past sessions and hand-corrected to the score they should have
 * received — given to the grader as anchors so the scale and the judgment
 * priorities stay fixed.
 *
 * They are NOT answer keys for today's article (they come from OTHER articles).
 * They teach the grader HOW to score — the meaning of the scale and what to
 * weight — not WHAT today's article says. Each carries a one-line transferable
 * principle in `why`; the principle is the payload, the number just anchors it.
 *
 * Curation notes:
 * - Names are deliberately omitted (the grader never sees the student's name, so
 *   the name can't bias the grade).
 * - The set spans the range (≈6.5 → 9) so the scale is anchored top to bottom,
 *   not just at the high end — this is what breaks the 8–9 compression.
 * - Two pairs share an article (so difficulty is held constant): a long, vivid
 *   retelling scores BELOW a tighter one that reached the subtle concepts; and a
 *   wide-but-flawed answer scores ABOVE an accurate-but-thin one. Those orderings
 *   are the lessons that matter most.
 * - To extend: promote a comparative review into a new entry here (condensed
 *   `covered` + the revised `score` + the principle in `why`).
 */

export type GradingExample = {
  /** Short title of the article the example came from (a DIFFERENT day). */
  article: string;
  /** What a top-band answer on THAT article would have covered — the ceiling. */
  ceiling: string;
  /** A condensed account of what the student actually covered (2–4 sentences). */
  covered: string;
  /** The expert-revised score this answer should receive. */
  score: string;
  /** The transferable grading principle this example teaches. */
  why: string;
};

export const GRADING_EXAMPLES: GradingExample[] = [
  {
    article: "The data-center boom and inflation",
    ceiling:
      "the full argument plus all four concepts: capital expenditure, demand vs. supply shock (and why an AI demand shock PERSISTS where one-time shocks fade), productivity as a later cure, and inflation expectations as a self-fulfilling loop.",
    covered:
      "Laid out the whole chain tightly: the build-out bids up shared inputs (chips, electricity, labor) so prices rise across the economy; explained capex; got the demand-shock-PERSISTS-vs-one-time-shock contrast; gave the two-phase productivity payoff; and, unprompted, walked the inflation-expectations wage-price loop as self-fulfilling. Only trivial slips (listed one company twice).",
    score: "9/10",
    why: "A complete, accurate account that reaches the article's HARDEST, subtlest ideas earns the top band; trivial factual slips do not pull it down.",
  },
  {
    article: "The data-center boom and inflation",
    ceiling:
      "the full argument plus all four concepts: capital expenditure, demand vs. supply shock and its persistence, productivity, and inflation expectations.",
    covered:
      "A LONGER, vivid retelling with rich concrete texture — what's inside a data center (chips, generators, cables), 24/7 power, and specific firms raising consumer prices — plus the productivity payoff. But it never reached the inflation-expectations loop, missed the demand-shock-persistence point, and only got the shock distinction when prompted, and even then tangled it.",
    score: "8/10",
    why: "Length and concrete detail are NOT depth. A longer, example-rich transcript that misses the subtlest concepts scores BELOW a tighter one that covers them — grade the distinct correct ideas covered, not the word count.",
  },
  {
    article: "How to win the World Cup",
    ceiling:
      "the statistical model and its concepts (proxy measure, path dependence, bottom-up vs. top-down), PLUS the article's major theme that openness to immigration / diaspora players is one of the strongest routes to success.",
    covered:
      "The WIDEST-ranging answer: covered the model, Japan's bottom-up rise vs. China's top-down spending, AND the immigration route, with original framing of his own (a 'rich get richer' analogy). But made one genuine conceptual error — inverted how the Elo rating relates to the underlying factors (treated the thing-being-explained as if it were built FROM the factors).",
    score: "8/10",
    why: "Reward breadth and independent thinking, but a genuine conceptual error about a core mechanism keeps even a wide-ranging, creative answer OUT of the top band.",
  },
  {
    article: "How to win the World Cup",
    ceiling:
      "the model and its concepts PLUS the major immigration / diaspora theme.",
    covered:
      "A clean, accurate, but SHORT retelling: got the model's factors and Japan-vs-China, all of it correct, but gave few specific examples and entirely missed the article's major immigration/diversity argument.",
    score: "6.5/10",
    why: "Accuracy alone is not enough. An answer that is correct but covers only the obvious points and skips a WHOLE major theme of the article sits in the middle band — calibrate against the article's full ceiling, not against 'did they say anything wrong.'",
  },
  {
    article: "Europeans should embrace air-conditioning",
    ceiling:
      "the culture clash, the clean-electricity country comparison, the climate/heat-DEATHS pillar that makes cooling a health issue, and the policy/economics tail (costs, efficiency, grids, fossil-fuel price-shock resilience).",
    covered:
      "The most INDEPENDENT reading: questioned the article's framing and connected the energy story to geopolitics and fuel price shocks — genuinely sharp analysis nobody else reached. But dropped the article's central health/heat-deaths pillar entirely, partly misread the thesis (downplayed how central air-conditioning itself is), and misremembered a key figure.",
    score: "7.5/10",
    why: "Relevant independent thinking is a real plus, but it cannot SUBSTITUTE for the article's own main pillars; dropping a core pillar and misreading the thesis pull the score down even when the outside analysis is the sharpest in the group.",
  },
];

/** Render the calibration examples as a prompt block. */
export function gradingExamplesBlock(): string {
  const items = GRADING_EXAMPLES.map((e, i) => {
    return [
      `Example ${i + 1} — from a different article ("${e.article}").`,
      `  A top answer there would cover: ${e.ceiling}`,
      `  What this student covered: ${e.covered}`,
      `  Correct score: ${e.score}`,
      `  Why: ${e.why}`,
    ].join("\n");
  }).join("\n\n");

  return `These are EXPERT-REVISED examples from OTHER days, given to keep your
scale and judgment consistent. They are NOT about today's article and are NOT an
answer key for it — use them only to calibrate HOW you score (what a 9 vs an 8 vs
a 6.5 means, and what to weight). Match today's transcript to whichever example
profile it most resembles, and apply the same principle.

${items}`;
}
