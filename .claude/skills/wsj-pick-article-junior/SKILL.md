---
name: wsj-pick-article-junior
description: Recommend JUNIOR-track (US grades 5–7) article candidates for the Reading Club, scouting both The Wall Street Journal and The Economist. Use when the user says "pick a junior article", "junior candidates", "what should the juniors read", or wants suggestions for the /junior track — including building the junior vote ballot (wsj-open-vote's junior mode draws its candidates from this skill's ranked field). Browses both homepages (checking each is logged in), checks what the junior track has read lately, shortlists 8 candidates and reads each one in full, then recommends a ranked pick plus runners-up for the user to choose from.
---

# WSJ Reading Club — pick a JUNIOR article (grades 5–7)

You are scouting the day's **Wall Street Journal** and **The Economist** for the Junior Reading Club. This is the junior sibling of `wsj-pick-article`: same two sources, same workflow, same "you only recommend" contract; the calibration is the whole difference. The user picks one of your recommendations and invokes **`wsj-reading-junior`** with the link, or on a vote day `wsj-open-vote` takes this skill's top 5 as the junior ballot. The unattended `auto-vote-junior` skill applies the same calibration on The Economist every morning.

## Who this is for

The readers are sharp US students in grades 5–7, ages 10 to 13. The handout will teach three words one band below SAT tier (the *reluctant / abundant / deliberate / fragile* register) and at most two concepts from scratch; everything else the article assumes, the reader must already hold. Pick what a good teacher would hand this class today: a full-text article a curious 11-year-old with no background can follow, told as a story rather than an argument. The prose in both papers often runs at grade 10–11 even when the story doesn't; that is fine, the handout bridges the prose, so pick by the story. Things a 10-year-old cannot do: lean on abstraction, read irony or satire literally, catch a columnist's allusions, or hold an article much past 1,200 words (over 1,500 is a pass unless exceptional; Briefings, 1843 long-reads and multi-part essays are out). Appropriateness is a 5th-grader's parent's call: nothing centred on violence, sexual content, drugs, self-harm, abuse, or bleak-without-payoff subjects; hard news and geopolitics are fine when the value is understanding, and when in doubt leave it out. Before browsing, read the junior track's last ten readings so you know what they have seen lately; overlap with the senior track's topics is not a strike:

```bash
for f in $(ls content/junior/2*.json | tail -10); do echo "$(basename $f .json)  $(grep -m1 '"title"' $f)"; done
```

## Browser: always use Playwright (never the Chrome extension)

Same hard rule as the senior skill: all browsing goes through the Playwright MCP browser tools (`mcp__plugin_playwright_playwright__browser_*`). The `claude-in-chrome` extension blocks `wsj.com` and `economist.com`; if a navigation returns "not allowed due to safety restrictions," you're on the wrong tool. See `wsj-pick-article` for the login-check gotcha (The Economist renders its body client-side, so a thin accessibility snapshot is not a paywall; read the DOM with `browser_evaluate` before concluding you're logged out).

## Workflow

Mirror the senior skill's workflow with these deltas:

1. **Build the published-URL exclude list** exactly as the senior skill does: `grep -h '"articleUrl"' content/*.json content/junior/*.json`, a hit on either track disqualifies before ranking.

2. **Browse both homepages** with the senior skill's login checks, sweeping with junior eyes. Collect a raw pool of 12–16 candidates; if the homepages are thin on junior stories, go to the sections where they live (Economist `/science-and-technology`, `/culture`, the regional sections; WSJ `/science`, `/sports`, `/lifestyle`). Shortlist exactly 8 on headlines and blurbs.

3. **Read all 8 in full** (`browser_evaluate` on `article p`) and judge from the actual text: the story, the three junior-register words, the two concepts, whether an 11-year-old can follow it, length, register, and appropriateness. Jot a one-line verdict and a rough 1–10 score per article. A dud gets dropped and replaced from the raw pool; finish having genuinely read 8.

4. **Recommend, grounded in every read.** The full ranked field (8 lines: rank, source, linked title, verdict/score), then one top pick expanded (the story, the words and concepts, why an 11-year-old can follow it) and 2–3 runners-up with trade-offs. Note any dud you dropped.

5. **Stop there.** The user chooses and invokes `wsj-reading-junior` (or says "go with the top pick", in which case run that skill with the URL). On a junior vote day `wsj-open-vote` takes this field's top 5, but that is its workflow, not yours.
