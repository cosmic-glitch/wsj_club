---
name: wsj-pick-article
description: Recommend today's article candidates for the Reading Club, scouting both The Wall Street Journal and The Economist. Use when the user says "pick an article", "what should we read today", "today's candidates", or wants article suggestions before creating the daily handout. Browses both homepages (checking each is logged in), checks what topics the club has already covered, verifies candidates are substantive text articles, and recommends a ranked top 2-3 for the user to choose from.
---

# WSJ Reading Club — pick today's article

You are scouting the day's **Wall Street Journal** *and* **The Economist** for the **WSJ Reading Club**: four kids in US grades 8–10, strong students (SAT verbal 600 to 680). The user runs this skill first each day, picks one of your recommendations after checking it, and then invokes the **wsj-reading** skill with the chosen link to build and deploy the handout. You only recommend here — do not write content files, capture PDFs, or deploy.

Scout **both sources every day** and rank candidates across the two together — The Economist's weekly features and science/culture coverage often beat the day's WSJ stories on learning payload, and vice versa. Treat them as one combined candidate pool; the source is just a label on each pick.

## What makes a good pick (the selection criteria)

1. **Quality, learnings, and articulation come first.** The best pick is the article with the richest learning payload — strong vocabulary, meaty teachable concepts, and a hook that makes a teenager want to read it (criterion 4) — *and written well*. **Articulation quality is a real criterion, not a tiebreaker:** favor clear, well-argued, vividly-written journalism over a worthy topic told flatly. The club is learning to think and write, so the prose they read should model good prose. Never pass over a clearly superior article just because its domain appeared recently.

2. **Lean toward worldly wisdom — general knowledge, finance, and modern forces like AI.** The whole point of the club is to make these kids *aware of how the world actually works* and to build durable, worldly judgment. So there is a **deliberate, standing bias** toward: broad general knowledge; finance, markets, and economics; and the highly relevant modern forces reshaping society — **AI above all**, plus the major technologies, businesses, and shifts driving the present. **These domains are welcome to recur** — a second strong finance or AI piece within a week is fine, even good, when it's genuinely the best article. Don't ration them, and don't apologize for picking them.

3. **Variety is a mild preference, not a quota.** A spread of topics over time *does* help build general knowledge, so — *all else roughly equal* — a domain not used in the last few days is a nice tiebreaker. But it is the **weakest** of these criteria: never let it override quality, articulation, or the lean toward finance/AI/worldly topics in (1)–(2). Use the coverage check to stay *aware* of what's been read recently, not to force a rotation or talk yourself out of the best article. Before browsing, glance at what's been covered:
   - `ls content/` and read the `title` (and skim `concepts`) of at least the **last 5** readings.
   - Classify each past reading into a rough domain: finance/markets, economics, geopolitics/world, US politics/law/civics, science/health, tech/AI, sports/culture, business/industry, lifestyle/work.
   - If your top pick repeats a recent domain because it's simply the best article (or because it's a finance/AI/general-knowledge piece, which we favor), just say so in one line and move on — a repeat is not a strike against it.

4. **Stretched but not stressed.** The sweet spot is an article a sharp 13–16-year-old finds genuinely interesting and *slightly* above their level:
   - Rich in SAT-sweet-spot vocabulary and 3–5 teachable concepts (the wsj-reading skill needs exactly 3 strong vocab words and 3–5 concepts — an article that can't supply those is a bad pick).
   - A hook a teenager would actually care about: a fun angle, a big question, a vivid story. A-Heds and features often beat dry incremental news.
   - Not over their heads (dense markets minutiae, inside-baseball politics) and not beneath them (listicles, shopping content, celebrity fluff).

5. **Appropriate.** Skip stories centered on graphic violence, sexual content, or anything a parent would balk at handing a 13-year-old. War/conflict coverage is acceptable when the value is geopolitical understanding, not gore.

6. **It must be a real text article you can actually read in full.** WSJ homepages mix in video-led pages that have only a couple of paragraphs of text — these cannot become handouts. The Economist is **hard-paywalled**: logged out, an article cuts off after its first paragraph with a "subscribe"/"sign up to continue" wall, so you can neither vet nor (later) build it — that's a login problem to fix (step 2), not a reason to drop the article. Verify before recommending (step 3 below). Opinion pieces are generally weaker picks than news/features: the club is learning how the world works, not adopting columnists' takes. Live-coverage pages, slideshows, and The Economist's chart-led *Graphic detail* stubs (little body text) don't work either.

## Browser: always use Playwright (never the Chrome extension)

**All browsing in this skill goes through the Playwright MCP browser tools** — `mcp__plugin_playwright_playwright__browser_navigate`, `browser_snapshot`, `browser_evaluate`, `browser_take_screenshot`, etc. Every `browser_*` call below means the Playwright one.

**Do NOT use the `claude-in-chrome` extension** (`mcp__claude-in-chrome__navigate` / `__computer` / `__read_page` …). Its server-side safety classifier **blocks `wsj.com` and `economist.com`** with the error *"This site is not allowed due to safety restrictions"* — a hard, un-fixable-from-here block (a fresh extension reinstall doesn't clear it; `WebFetch` to these domains is blocked too). Playwright drives its own browser, isn't subject to that classifier, and is what every prior day used successfully. If a navigation ever returns "not allowed due to safety restrictions," you're on the wrong tool — switch to the Playwright `browser_*` tools and retry.

## Workflow

1. **Check coverage history.** `ls content/` and `grep -h '"title"' content/*.json` (read recent files for their concepts if titles are ambiguous). Note the domains of roughly the last 5 readings.

2. **Browse both homepages.** Scout **two** homepages every day and pool the candidates: WSJ (`https://www.wsj.com/`) and The Economist (`https://www.economist.com/`). For each one:
   - **Check login first — but confirm via the DOM, don't trust the snapshot.** The user keeps both sites logged in *in this browser* (they have subscriptions to both), but sessions can expire. **Important gotcha:** The Economist renders its article body *client-side*, so the accessibility snapshot (`browser_snapshot`) shows only the **lede paragraph plus a "sign up to our subscriber-only newsletter" box** even when you're fully logged in — that newsletter box is **not** a paywall. So a short snapshot is **not** evidence of being logged out. Before ever concluding a source is logged-out/paywalled, read the actual article body from the DOM with `browser_evaluate` (e.g. `Array.from(document.querySelectorAll('article p')).map(p=>p.innerText)`). Only if the DOM *itself* shows a genuine wall — a "Subscribe to continue" / "to read the full article" block, a login form, or a body truly truncated to one or two paragraphs — should you **stop and ask the user to log into that site in this browser**, wait for them to confirm, then re-navigate. Never silently skip a source or recommend from one you couldn't actually read — fix the login instead.
   - Read the snapshot and sweep the whole homepage. **WSJ:** Top Stories, the section straps (World, Tech, Business & Finance, Health, Arts & Culture, Travel...), and "Most Popular News". **The Economist:** Leaders, Briefing, the regional sections (United States, China, Asia, Europe, Britain, Middle East & Africa, The Americas, International), Business, Finance & economics, Science & technology, Culture, and the **1843** long-reads.
   - Collect **5–8 raw candidates total across both sources**, each tagged with its source (WSJ / Economist), URL, and a one-line blurb. If a homepage is thin on good candidates, peek at one or two section pages (WSJ `/science`, `/world`; Economist `/science-and-technology`, `/culture`).
   - *Practical note:* these homepage snapshots are very large. It's fine to save the snapshot and `grep` it for article URLs/headlines (e.g. dated `/section/20xx/mm/dd/slug` paths on The Economist) rather than reading the whole thing inline. For reading an **article body** (verification, gauging vocab/concepts), prefer `browser_evaluate` over the snapshot — especially on The Economist, whose body only appears in the DOM, not the accessibility snapshot.

3. **Verify the shortlist.** For the top 2–3 candidates, open each article URL and confirm it is a substantive text article you can read **in full** — multiple real paragraphs; on WSJ ideally a "Listen (N min)" marker of ~4 minutes or more. **On The Economist, check the body with `browser_evaluate` reading `article p` from the DOM — the accessibility snapshot under-renders it to the lede only, which is *not* a paywall** (see the login gotcha in step 2). Only treat it as logged-out if the DOM itself shows a genuine subscribe/login wall, in which case ask the user to log in and re-open it — don't drop the article. Drop anything that turns out to be video-led ("Watch the video above..."), a live blog, a chart-only *Graphic detail* stub, or a stub, and promote the next candidate.

4. **Recommend.** Present to the user (each pick tagged with its **source — WSJ or Economist**):
   - **One top pick** with its source, URL, and a short case for it: the vocab/concept richness you spotted, how well it's written (articulation quality), the hook for a teenager, and the domain. A recent-domain repeat is fine — mention it in a few words and don't treat it as a mark against the pick, especially for a finance/AI/general-knowledge piece (the favored lean).
   - **2–3 runners-up**, one line each: source, URL, domain, and the trade-off (e.g. "timelier but lighter", "stretchier but heavier topic", "sharper writing but a drier topic"). Frame a domain repeat neutrally, not as a demerit.
   - Note anything you rejected for a non-obvious reason (e.g. "the fun-looking X piece is video-only") so the user doesn't re-suggest it.

5. **Stop there.** The user is the validation layer: they will read your pick and either choose it or pick another. Do not invoke the wsj-reading skill yourself — wait for the user to choose and invoke it (they may just say "go with the top pick", in which case run wsj-reading with that URL).
