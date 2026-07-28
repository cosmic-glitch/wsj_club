---
name: wsj-pick-enrichment
description: Recommend today's ENRICHMENT read for the Reading Club — five candidate pieces drawn from a broader, mostly-free pool of timeless-wisdom sources (Farnam Street, Our World in Data, Paul Graham, and the wider tier list below), NOT the daily WSJ/Economist news. Use when the user says "pick an enrichment article", "find an enrichment read", "propose enrichment pieces", "a wisdom read", "a mental-models piece", or wants a candidate from the broader sources rather than the day's news. Checks what's already been used, gathers candidates across the sources, reads each in full, verifies each is ≤2,000 words, and proposes five ranked picks (with a clear top pick) for the user to choose from.
---

# Reading Club — pick today's enrichment read

You are scouting a **broad pool of timeless-wisdom sources** for the **Reading Club** (four kids, US grades 8–10, strong students, SAT verbal 600–680). This is the **companion** to `wsj-pick-article`: that skill scouts the day's **news** (WSJ + The Economist); this one scouts the **enrichment layer** — the durable "how to think about money / progress / systems" reads that build worldly wisdom rather than report what happened today. You **only recommend** — do not write content files, capture article pages, or deploy. The user picks one of your five, then invokes **`wsj-reading`** with that link to build and deploy the handout (the reading skill is source-agnostic — it just needs a URL).

**Output: propose FIVE candidate pieces**, ranked, with a clear top pick — mirroring the shortlist format the user already validated. Aim for **variety across the five** (different sources and different flavors of wisdom), so the user gets a real choice, not five near-duplicates.

## Where these sources came from (the golden source)

The club's ~30+ published readings are the real statement of intent: **positive-leaning, Munger-style worldly wisdom, heavy on AI/tech as the force reshaping the world.** The news sources (WSJ/Economist/Quanta) cover *what happened*; the gap they leave is **mental models taught as mental models** — the transferable frames under the news. This skill fills that gap. Two Paul Graham + Asimov picks already in the catalog were the seed of a deliberate **timeless-canon** thread.

## The source pool

Tiered by how well each fits a **daily** read (the ≤2,000-word rule below is the binding filter — it selects the Tier-1 four as the natural daily sources and makes the rest occasional-with-excerpting).

### Excluded source — never propose (owner's standing rule, 2026-07-17)
- **Morgan Housel / Collab Fund** (`collabfund.com`, `collaborativefund.com`, or his pieces republished anywhere) is **permanently excluded** from the enrichment pool by the owner's explicit instruction. Do not propose, shortlist, or pitch his essays — from any domain — regardless of fit. (The finance-*wisdom* layer is covered instead by Farnam Street, the Buffett/Bezos letters, and Buttonwood-style news picks.)

### Tier 1 — fit natively at daily length; scout these first every time
- **Farnam Street (fs.blog)** — literally built on Munger's "latticework of mental models": inversion, compounding, second-order thinking, circle of competence. The most on-the-nose fit for the club's goal. Feed: `https://fs.blog/blog/` · Models hub: `https://fs.blog/mental-models/`
- **Our World in Data** — empirical optimism from Oxford + **data literacy** (reading a *trend*, not a headline); the antidote to news negativity bias. Recent: `https://ourworldindata.org/latest` · Articles: `https://ourworldindata.org/articles` · Data insights: `https://ourworldindata.org/data-insights`
- **Paul Graham (short essays)** — canon life/work wisdom, plain HTML, age-proof. Index: `https://www.paulgraham.com/articles.html` (pick the *shorter* ones to stay in range — many run long)

### Tier 2 — richer but usually run long; use occasionally, and the handout distills/excerpts a section
- **Works in Progress** (`https://worksinprogress.co/`) — structurally optimistic progress-studies ("here's how the world got better, and the mechanism"); superb systems-thinking. ~3,000–6,000 words.
- **Wait But Why** (`https://waitbutwhy.com/archive`) — the best big-idea explainer for exactly this age (AI, space, Fermi paradox), funny and vivid. Very long — excerpt one section.
- **Construction Physics** (`https://www.construction-physics.com/`) — how the physical world actually gets built; engineering/infrastructure mental models. ~2,000–4,000 words.
- **Smithsonian Magazine** (`https://www.smithsonianmag.com/`) — reliably positive narrative history/science/culture; natural home for the "soccer nation / founding fathers" texture vein.
- **MIT Technology Review** (`https://www.technologyreview.com/`) — grounded, forward-looking AI/tech; the one way to add real **AI weight** to the enrichment layer. Partial paywall (the caveat here).

### Tier 3 — the "timeless canon" as a deliberate *source-type* (not a publication)
Free, age-proof essays/short fiction worth mining on purpose: **Paul Graham** (more), **Richard Hamming** *You and Your Research*, **Vannevar Bush** *As We May Think* (1945, predicts the web), **Feynman** *Cargo Cult Science*, **Carl Sagan** *Pale Blue Dot*, **Ted Chiang** (essays + fiction), **Patrick Collison**, and the **Buffett / Bezos shareholder letters**. (Asimov's *The Last Question* and PG essays are already in the catalog — this thread is live.)

**Honest note on AI weight:** at ≤2,000 words these sources carry little AI (OWID's AI explainer ~3,200 words; Wait But Why is huge). That's fine and expected — **keep the AI dailies on WSJ / The Economist / MIT Tech Review**, and treat this skill as the **wisdom / progress / mental-models / data-literacy** layer around them. Don't force an AI angle here, and don't apologize for a pick being wisdom-focused.

## What makes a good enrichment pick (selection criteria)

Shares the reading-club DNA of `wsj-pick-article` (see that skill for the long form), plus enrichment-specific rules. In priority order:

1. **The ≤2,000-word rule is a HARD gate.** Target **~1,000 words**, up to **2,000 max**. A daily read = handout + voice quiz; longer than this gets onerous. **Verify the word count before proposing** (see Tools). A brilliant piece over the ceiling is not a daily pick — either excerpt one self-contained section (Tier 2/3) or pass. Never propose a piece you didn't size.

2. **Positive-leaning and constructive.** An explicit, standing bias: the piece should take a hopeful, capability-building view of the world — progress, how a system works, what something taught us — never doom. This is the club's tone made concrete.

3. **Teaches a transferable mental model (Munger worldly wisdom).** The whole point of the enrichment layer. The best pick hands the reader a **durable frame they can reuse** — inversion, compounding, circle of competence, revealed vs. stated preference, reading a trend not a headline, second-order effects. Prefer a piece that *builds* a model from everyday intuition over one that merely narrates. Name **3–5 teachable concepts** and the **1 headline model** it leaves the reader with.

4. **Stretched but not stressed — the prerequisite-load gate still applies.** Could a curious 14-year-old with **no background** follow the core argument, given the handout teaches only ~3 concepts from scratch? One new hard idea = the stretch we want; a *stack* of interlocking assumed concepts = a bad pick however wise or well-written. (Same hard gate as `wsj-pick-article` criterion 4.) These sources are usually *more* accessible than a dense Economist feature — but a Farnam Street piece assuming finance, or a shareholder-letter excerpt leaning on accounting, can still overshoot; check.

5. **Rich enough to build a handout.** Needs **3 strong SAT-sweet-spot vocab words** and **3–5 teachable concepts** (what `wsj-reading` requires). A lovely but thin aphorism-essay that can't supply those is a weak pick.

6. **Articulate + appropriate + genuinely interesting.** Crisp, well-argued prose (the club learns to write by reading good writing); nothing a parent would balk at handing a 13-year-old; and a hook a teen actually cares about.

7. **Timeless beats timely; avoid repeats.** Unlike the news skill, freshness/recency is **not** a criterion — a 2005 Paul Graham essay is as good as one posted yesterday. So there's no coverage-recency pressure, but you **must not re-propose a piece already used.** Build the exclude-list from the content files (Workflow step 1). Also lightly avoid re-hitting the *same source* two enrichment days running when a different source offers a comparably strong pick — variety across the whole enrichment layer is a mild plus (never override 1–6).

## Tools: WebFetch/WebSearch first, Playwright to verify

These sources are **open and mostly not paywalled** — and the `claude-in-chrome`/`WebFetch` block that hits `wsj.com`/`economist.com` does **not** apply to them. So this skill is lighter-weight than `wsj-pick-article`:
- **Discover candidates** with `WebSearch` (e.g. `site:fs.blog mental models`, `site:ourworldindata.org`) and by fetching each source's **hub/archive** page (above) with `WebFetch`.
- **Read each candidate in full** with `WebFetch` (ask it for the full article text + an approximate word count). Paul Graham's plain-HTML pages and the blogs fetch cleanly.
- **Verify the word count** — the ≤2,000 gate is binding, so don't trust an eyeballed estimate near the ceiling. When a piece is close to the limit or WebFetch under-returns, confirm with **Playwright** (`mcp__plugin_playwright_playwright__browser_navigate` then `browser_evaluate`): e.g. `document.querySelector('article, .article, #content, main').innerText.trim().split(/\s+/).length`. Playwright is also the fallback for any JS-heavy page (some Our World in Data pages) where WebFetch returns thin text. (Playwright is the same browser the club always uses; no login needed for these sources.)

## Workflow

1. **Build the exclude-list (already-used pieces).** `grep -rhoE '"(articleUrl|url)":\s*"[^"]+"' content/*.json` and pull the non-WSJ/Economist URLs (fs.blog, ourworldindata.org, paulgraham.com, and any canon domains). Never re-propose one of these. (Morgan Housel is excluded categorically — see the Excluded source note above — independent of this per-piece list.) Also skim the last ~5 readings' titles so you know which enrichment source was used most recently (mild variety input for criterion 7).

2. **Gather a candidate pool across the sources.** Prioritise the **Tier-1 four** (they fit natively). Pull their archive/feed pages and collect promising pieces; add a couple of **Tier-3 canon** candidates and, when one is strong enough to justify excerpting, a **Tier-2** piece. Aim for a raw pool of **~8–12** candidates spanning **at least 3 different sources**, each with source, URL, and a one-line reason it looks like a fit. Skip anything you already know is off (over the ceiling with no self-contained excerpt, off-tone, a data-only chart page with no argument).

3. **Read each in full and size it.** For every candidate you'll propose, actually read the body (WebFetch) and **verify it's ≤2,000 words** (Playwright if near the ceiling / thin fetch). Judge from the real text: the **headline mental model** + 3–5 teachable concepts, the **prerequisite-load gate**, vocab richness (3 strong words), positivity/tone, articulation, and teen hook. Jot a one-line verdict + rough word count per piece. Drop any that fail the word gate or the prerequisite gate and pull another from the pool, so you finish with **five genuinely-read, in-range pieces across a spread of sources.**

4. **Propose the five.** Present a **ranked list of five**, each one line: rank, **source**, **linked title**, **~word count (verified)**, the **headline model/wisdom** it teaches, and a one-line fit verdict. Then expand the **#1 top pick**: its URL, the specific concepts + vocab you found, the mental model it leaves the reader with, why the tone/hook fits, and its word count. For the other four, give each a short trade-off line (e.g. "tighter but lighter", "richer model but needs an excerpt", "same flavor as #1 from a different source"). Note the **spread of sources** you covered and call out anything you **excluded as already-used**.

5. **Stop there.** The user is the validation layer — they'll pick one (or ask for another sweep) and then invoke `wsj-reading` with the chosen URL. Do **not** invoke `wsj-reading` yourself.
