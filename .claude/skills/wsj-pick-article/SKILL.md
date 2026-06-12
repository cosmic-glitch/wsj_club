---
name: wsj-pick-article
description: Recommend today's WSJ article candidates for the Reading Club. Use when the user says "pick an article", "what should we read today", "today's candidates", or wants article suggestions before creating the daily handout. Browses the WSJ homepage, checks what topics the club has already covered, verifies candidates are substantive text articles, and recommends a ranked top 2-3 for the user to choose from.
---

# WSJ Reading Club — pick today's article

You are scouting the day's Wall Street Journal for the **WSJ Reading Club**: four kids in US grades 8–10, strong students (SAT verbal late-500s to late-600s). The user runs this skill first each day, picks one of your recommendations after checking it, and then invokes the **wsj-reading** skill with the chosen link to build and deploy the handout. You only recommend here — do not write content files, capture PDFs, or deploy.

## What makes a good pick (the selection criteria)

1. **Quality and learnings come first.** The best pick is the article with the richest learning payload — strong vocabulary, meaty teachable concepts, and a hook that makes a teenager want to read it (criterion 2). Never pass over a clearly superior article just because its domain appeared recently.

2. **Variety across days is preferred, not required.** The club should build *general* knowledge, so all else roughly equal, favor a domain not used in the last few days. Use it as a tiebreaker between comparable candidates, not a filter. Before browsing, check what's already been covered:
   - `ls content/` and read the `title` (and skim `concepts`) of at least the **last 5** readings.
   - Classify each past reading into a rough domain: finance/markets, economics, geopolitics/world, US politics/law/civics, science/health, tech/AI, sports/culture, business/industry, lifestyle/work.
   - If your top pick repeats a recent domain because it's simply the best article, say so and note the repeat.

3. **Stretched but not stressed.** The sweet spot is an article a sharp 13–16-year-old finds genuinely interesting and *slightly* above their level:
   - Rich in SAT-sweet-spot vocabulary and 3–5 teachable concepts (the wsj-reading skill needs exactly 3 strong vocab words and 3–5 concepts — an article that can't supply those is a bad pick).
   - A hook a teenager would actually care about: a fun angle, a big question, a vivid story. A-Heds and features often beat dry incremental news.
   - Not over their heads (dense markets minutiae, inside-baseball politics) and not beneath them (listicles, shopping content, celebrity fluff).

4. **Appropriate.** Skip stories centered on graphic violence, sexual content, or anything a parent would balk at handing a 13-year-old. War/conflict coverage is acceptable when the value is geopolitical understanding, not gore.

5. **It must be a real text article.** WSJ homepages mix in video-led pages that have only a couple of paragraphs of text — these cannot become handouts. Verify before recommending (step 3 below). Opinion pieces are generally weaker picks than news/features: the club is learning how the world works, not adopting columnists' takes. Live-coverage pages and slideshows don't work either.

## Workflow

1. **Check coverage history.** `ls content/` and `grep -h '"title"' content/*.json` (read recent files for their concepts if titles are ambiguous). Note the domains of roughly the last 5 readings.

2. **Browse the homepage.** `browser_navigate` to `https://www.wsj.com/` and read the snapshot. The user stays logged into WSJ in this browser; if the page looks logged-out or paywalled, ask them to log in and re-navigate. Sweep the whole homepage — Top Stories, the section straps (World, Tech, Business & Finance, Health, Arts & Culture, Travel...), and "Most Popular News". Collect 5–8 raw candidates with their URLs and one-line blurbs. If the homepage is thin on good candidates, also peek at one or two section pages (e.g. `/world`, `/science`).

3. **Verify the shortlist.** For the top 2–3 candidates, open each article URL and confirm from the snapshot that it is a substantive text article — multiple real paragraphs, ideally a "Listen (N min)" marker of ~4 minutes or more. Drop anything that turns out to be video-led ("Watch the video above..."), a live blog, or a stub, and promote the next candidate.

4. **Recommend.** Present to the user:
   - **One top pick** with its URL and a short case for it: the vocab/concept richness you spotted, the hook for a teenager, and the domain (noting whether it varies from or repeats recent days).
   - **2–3 runners-up**, one line each: URL, domain, and the trade-off (e.g. "timelier but lighter", "stretchier but heavier topic", "great but econ again two days running").
   - Note anything you rejected for a non-obvious reason (e.g. "the fun-looking X piece is video-only") so the user doesn't re-suggest it.

5. **Stop there.** The user is the validation layer: they will read your pick and either choose it or pick another. Do not invoke the wsj-reading skill yourself — wait for the user to choose and invoke it (they may just say "go with the top pick", in which case run wsj-reading with that URL).
