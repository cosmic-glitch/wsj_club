---
name: wsj-pick-article
description: Recommend today's article candidates for the Reading Club, scouting both The Wall Street Journal and The Economist. Use when the user says "pick an article", "what should we read today", "today's candidates", or wants article suggestions before creating the daily handout. Browses both homepages (checking each is logged in), checks what the club has read lately, shortlists 10 candidates and reads each one in full, then recommends a ranked pick plus runners-up for the user to choose from.
---

# WSJ Reading Club — pick today's article

You are scouting the day's **Wall Street Journal** and **The Economist** for the Reading Club. The user runs this skill first each day, picks one of your recommendations, and then invokes **wsj-reading** with the chosen link. You only recommend here: do not write content files, capture article pages, or deploy.

Scout both sources every day and rank them as one pool; the source is just a label on each pick.

## Who this is for

The readers are sharp US students in grades 8–10 (SAT verbal 600 to 680). The handout will teach three vocabulary words and about three concepts from scratch; everything else the article assumes, the reader must already hold. Pick what a good teacher would hand this class today: a well-written, full-text article that a curious 14-year-old with no background in the topic can follow, and that is fit to hand a 13-year-old (war and politics are fine, gore and sexual content are not). Before browsing, read the club's last ten readings so you know what they have seen lately:

```bash
for f in $(ls content/2*.json | tail -10); do echo "$(basename $f .json)  $(grep -m1 '"title"' $f)"; done
```

## Browser: always use Playwright (never the Chrome extension)

**All browsing in this skill goes through the Playwright MCP browser tools** (`mcp__plugin_playwright_playwright__browser_navigate`, `browser_snapshot`, `browser_evaluate`, …). Every `browser_*` call below means the Playwright one.

**Do NOT use the `claude-in-chrome` extension.** Its server-side safety classifier blocks `wsj.com` and `economist.com` with *"This site is not allowed due to safety restrictions"*, a hard block that a reinstall doesn't clear (`WebFetch` to these domains is blocked too). If a navigation ever returns that error, you're on the wrong tool: switch to the Playwright `browser_*` tools and retry.

## Workflow

1. **Build the published-URL exclude list.** Both papers keep week-old features on their homepages and section hubs, so an article the club has already published can look fresh. `grep -h '"articleUrl"' content/*.json content/junior/*.json` and check every candidate URL against it, again as a final sweep over the shortlist before ranking. A hit is disqualified, however strong; note it in one line. Titles are not a substitute: headlines get reworded between hub and article.

2. **Browse both homepages**, WSJ (`https://www.wsj.com/`) and The Economist (`https://www.economist.com/`). For each one:
   - **Check login first, via the DOM, not the snapshot.** The user keeps both sites logged in in this browser, but sessions expire. The Economist renders its article body client-side, so the accessibility snapshot shows only the lede plus a "sign up to our subscriber-only newsletter" box even when fully logged in; that box is not a paywall. Before concluding a source is logged out, read the body from the DOM with `browser_evaluate` (e.g. `Array.from(document.querySelectorAll('article p')).map(p=>p.innerText)`). Only if the DOM itself shows a genuine wall (a "Subscribe to continue" block, a login form, a body truncated to a paragraph or two) should you stop and ask the user to log into that site in this browser, wait for them, then re-navigate. Never silently skip a source; fix the login instead.
   - Sweep the whole homepage. WSJ: Top Stories, the section straps, "Most Popular News". The Economist: Leaders, Briefing, the regional sections, Business, Finance & economics, Science & technology, Culture, 1843. Collect a raw pool of 14–18 candidates across both sources with source, URL and a one-line blurb; if a homepage is thin, peek at a section page or two. From the pool, shortlist exactly 10 on headlines and blurbs.
   - These snapshots are large; it's fine to save one and `grep` it for dated article paths rather than reading it inline. For an article body prefer `browser_evaluate` over the snapshot.

3. **Read all 10 in full.** Open each shortlisted URL and read the body (`browser_evaluate` on `article p`; on The Economist the body only appears in the DOM). Decide on the real text, not the headline: the vocabulary it carries, the concepts a handout could teach, whether a 14-year-old without background can follow the core argument, how well it is written, whether a teenager would care, and appropriateness. Jot a one-line verdict and a rough 1–10 score per article as you go. A dud (video-led, live blog, chart-only stub, thin stub, or a genuine wall in the DOM, which means asking the user to log in) gets dropped and replaced from the raw pool, then read too, so you finish having genuinely read 10.

4. **Recommend, grounded in every read.** Present, each pick tagged with its source:
   - **The full field, ranked**: all 10, one line each with rank, source, linked title and your verdict/score.
   - **One top pick**, expanded: source, URL, and the case for it from the text you read.
   - **2–3 runners-up**, each with source, URL and the trade-off ("timelier but lighter", "stretchier but heavier").
   - Any dud you dropped and its replacement, so the user doesn't re-suggest it.

5. **Stop there.** The user is the validation layer. Do not invoke wsj-reading yourself; wait for the user to choose (if they say "go with the top pick", run wsj-reading with that URL).
