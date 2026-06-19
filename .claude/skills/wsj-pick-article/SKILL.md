---
name: wsj-pick-article
description: Recommend today's article candidates for the Reading Club, scouting both The Wall Street Journal and The Economist. Use when the user says "pick an article", "what should we read today", "today's candidates", or wants article suggestions before creating the daily handout. Browses both homepages (checking each is logged in), checks what topics the club has already covered, verifies candidates are substantive text articles, and recommends a ranked top 2-3 for the user to choose from.
---

# WSJ Reading Club — pick today's article

You are scouting the day's **Wall Street Journal** *and* **The Economist** for the **WSJ Reading Club**: four kids in US grades 8–10, strong students (SAT verbal 600 to 680). The user runs this skill first each day, picks one of your recommendations after checking it, and then invokes the **wsj-reading** skill with the chosen link to build and deploy the handout. You only recommend here — do not write content files, capture PDFs, or deploy.

Scout **both sources every day** and rank candidates across the two together — The Economist's weekly features and science/culture coverage often beat the day's WSJ stories on learning payload, and vice versa. Treat them as one combined candidate pool; the source is just a label on each pick.

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

5. **It must be a real text article you can actually read in full.** WSJ homepages mix in video-led pages that have only a couple of paragraphs of text — these cannot become handouts. The Economist is **hard-paywalled**: logged out, an article cuts off after its first paragraph with a "subscribe"/"sign up to continue" wall, so you can neither vet nor (later) build it — that's a login problem to fix (step 2), not a reason to drop the article. Verify before recommending (step 3 below). Opinion pieces are generally weaker picks than news/features: the club is learning how the world works, not adopting columnists' takes. Live-coverage pages, slideshows, and The Economist's chart-led *Graphic detail* stubs (little body text) don't work either.

## Workflow

1. **Check coverage history.** `ls content/` and `grep -h '"title"' content/*.json` (read recent files for their concepts if titles are ambiguous). Note the domains of roughly the last 5 readings.

2. **Browse both homepages.** Scout **two** homepages every day and pool the candidates: WSJ (`https://www.wsj.com/`) and The Economist (`https://www.economist.com/`). For each one:
   - **Check login first — this gates everything.** The user keeps both sites logged in *in this browser*, but sessions expire. If a homepage (or, later, a verification article) looks **logged-out or paywalled** — a truncated body that stops after the first paragraph, or a "Subscribe" / "sign up to continue" / "sign in" prompt where the article should be — **stop and ask the user to log into that specific site in this browser**, wait for them to confirm they're done, then re-navigate before going on. The user *can* log into both (they have subscriptions), so never silently skip a source or recommend from one you couldn't actually read — fix the login instead. The Economist is the one that bites: it hard-paywalls logged-out readers after the first paragraph.
   - Read the snapshot and sweep the whole homepage. **WSJ:** Top Stories, the section straps (World, Tech, Business & Finance, Health, Arts & Culture, Travel...), and "Most Popular News". **The Economist:** Leaders, Briefing, the regional sections (United States, China, Asia, Europe, Britain, Middle East & Africa, The Americas, International), Business, Finance & economics, Science & technology, Culture, and the **1843** long-reads.
   - Collect **5–8 raw candidates total across both sources**, each tagged with its source (WSJ / Economist), URL, and a one-line blurb. If a homepage is thin on good candidates, peek at one or two section pages (WSJ `/science`, `/world`; Economist `/science-and-technology`, `/culture`).
   - *Practical note:* these homepage snapshots are very large. It's fine to save the snapshot and `grep` it for article URLs/headlines (e.g. dated `/section/20xx/mm/dd/slug` paths on The Economist) rather than reading the whole thing inline.

3. **Verify the shortlist.** For the top 2–3 candidates, open each article URL and confirm from the snapshot that it is a substantive text article you can read **in full** — multiple real paragraphs; on WSJ ideally a "Listen (N min)" marker of ~4 minutes or more. **If an Economist candidate is cut off at the paywall, that's the login check (step 2) firing — ask the user to log in and re-open it**, don't drop it. Drop anything that turns out to be video-led ("Watch the video above..."), a live blog, a chart-only *Graphic detail* stub, or a stub, and promote the next candidate.

4. **Recommend.** Present to the user (each pick tagged with its **source — WSJ or Economist**):
   - **One top pick** with its source, URL, and a short case for it: the vocab/concept richness you spotted, the hook for a teenager, and the domain (noting whether it varies from or repeats recent days).
   - **2–3 runners-up**, one line each: source, URL, domain, and the trade-off (e.g. "timelier but lighter", "stretchier but heavier topic", "great but econ again two days running").
   - Note anything you rejected for a non-obvious reason (e.g. "the fun-looking X piece is video-only") so the user doesn't re-suggest it.

5. **Stop there.** The user is the validation layer: they will read your pick and either choose it or pick another. Do not invoke the wsj-reading skill yourself — wait for the user to choose and invoke it (they may just say "go with the top pick", in which case run wsj-reading with that URL).
