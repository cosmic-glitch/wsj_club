---
name: wsj-pick-article-junior
description: Recommend JUNIOR-track (US grades 5–7) article candidates for the Reading Club, scouting both The Wall Street Journal and The Economist. Use when the user says "pick a junior article", "junior candidates", "what should the juniors read", or wants suggestions for the /junior track — including building the junior vote ballot (wsj-open-vote's junior mode draws its candidates from this skill's ranked field). Browses both homepages (checking each is logged in), checks what the junior track has already covered, shortlists 8 candidates and reads each one in full, then recommends a ranked pick plus runners-up for the user to choose from.
---

# WSJ Reading Club — pick a JUNIOR article (grades 5–7)

You are scouting the day's **Wall Street Journal** *and* **The Economist** for the **Junior Reading Club**: sharp kids in **US grades 5–7** (ages 10–13). This is the junior sibling of the senior `wsj-pick-article` skill — same two sources, same "you only recommend" contract, but the calibration is the whole difference. The user picks one of your recommendations and then invokes **`wsj-reading-junior`** with the chosen link (or the picks feed the **junior vote ballot** — `wsj-open-vote --track=junior` takes this skill's top 5). You only recommend here — do not write content files, capture article pages, or deploy.

Scout **both sources** and rank candidates across the two together, one combined pool; the source is just a label on each pick.

## What makes a good JUNIOR pick

**The senior skill's criteria apply, re-centered two grade bands down.** Read `wsj-pick-article`'s SKILL.md criteria for the full reasoning; here is what changes for grades 5–7:

1. **Story first.** WSJ and The Economist have no easier tier — the *prose* is often grade 10–11 even when the *story* isn't. That's fine: the handout bridges the prose. So pick by the **story**: narrative, characters, a concrete situation, a question a 11-year-old would actually ask. Abstract argument pieces, however well written, are usually senior material. A vivid A-Hed, a science/animal/sports/space/money-in-real-life story, a "how does this actually work" feature — that's the junior sweet spot.

2. **The prerequisite-load gate is even harder here.** The senior test ("could a curious 14-year-old with no background follow the core argument?") becomes: could a curious **11-year-old** follow it, given the handout teaches only ~2 concepts from scratch? A middle-schooler can't lean on abstraction at all — one genuinely new idea, taught concretely, is the right stretch; anything that assumes a stack of background is an automatic pass. This gate vetoes payload, always.

3. **Vocab and concepts at the junior calibration.** The article must supply **3 words worth teaching one band below SAT tier** (the *reluctant / abundant / deliberate / fragile* register — real growth for grades 5–7, not obscure) and **the 2 most important transferable concepts** (junior runs 2, not the senior 3–5 — see `wsj-reading-junior`'s calibration). An article that can't yield those is a bad pick even if the story is fun.

4. **Appropriateness is stricter.** This is a 10-year-old's handout: skip stories centered on violence, sexual content, drugs/addiction, or bleak-without-payoff subjects a parent would balk at handing a 5th grader. Geopolitics and hard news are fine when the value is understanding, but the bar sits lower than senior's.

5. **Worldly-wisdom lean, junior edition.** The club's standing bias (general knowledge, money, how-the-world-works, modern forces like AI) still applies — junior is where those instincts get planted — but expressed through concrete stories, not markets minutiae.

6. **It must be a real text article you can read in full** — same rule as senior (no video-led pages, live blogs, chart-only stubs; The Economist hard-paywalls logged-out readers, which is a login problem to fix, not a reason to drop a piece).

7. **Coverage check runs on the JUNIOR dir.** `ls content/junior/` and skim those titles/concepts (the track is occasional, so this list is short). Also glance at recent senior titles for awareness — but overlap with the senior track is **not** a strike: the two tracks serve different kids, and a story worth teaching twice at two depths is fine.

## Browser: always use Playwright (never the Chrome extension)

Same hard rule as the senior skill: **all browsing goes through the Playwright MCP browser tools** (`mcp__plugin_playwright_playwright__browser_*`). The `claude-in-chrome` extension's safety classifier **blocks `wsj.com` and `economist.com`** (and `WebFetch` to them) — if a navigation returns "not allowed due to safety restrictions," you're on the wrong tool. See `wsj-pick-article`'s SKILL.md for the full login-check gotchas (especially: The Economist renders its body client-side, so a thin accessibility snapshot is **not** evidence of a paywall — read the DOM with `browser_evaluate` before ever concluding you're logged out).

## Workflow

Mirror the senior skill's workflow with these deltas:

1. **Check junior coverage.** `ls content/junior/` and read the titles (and skim concepts) of the recent junior readings; glance at the last few senior titles for awareness only.

2. **Browse both homepages** (WSJ + The Economist), with the senior skill's login checks. Sweep widely and collect a raw pool of **12–16 candidates**, tagged with source, URL, and a one-line blurb — but sweep with junior eyes: features, science/nature, sports, space, animals, money-in-real-life, how-things-work. From the raw pool, shortlist **exactly 8** on the headlines/blurbs alone.

3. **Read all 8 in full — don't decide on headlines.** For each, pull the real body (`browser_evaluate` on `article p`) and judge from the actual text: the story hook for a 10–13 year old, the 3 junior-register vocab words, the 2 transferable concepts, the prerequisite load (the 11-year-old gate — bake it into the score as a cap), articulation, and appropriateness. Jot a one-line verdict + rough 1–10 score per article. A dud (video-led, live blog, stub, genuine paywall) gets dropped and replaced from the raw pool — finish having genuinely read 8.

4. **Recommend — grounded in all 8 reads.** Present the **full ranked field** (one line each: rank, source, linked title, domain, verdict/score), then **one top pick** expanded (the story hook, the vocab/concepts you found, why it clears the 11-year-old gate) and **2–3 runners-up** with trade-offs. Note any dud you dropped and why.

5. **Stop there.** The user is the validation layer — they choose and invoke `wsj-reading-junior` (or say "go with the top pick", in which case run that skill with the URL). On a **junior vote day**, the `wsj-open-vote` skill takes this field's **top 5** as the ballot instead — but that's its workflow, not yours.
