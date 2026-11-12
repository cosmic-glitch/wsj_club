---
name: wsj-pick-article-elementary
description: EXPERIMENTAL — recommend ELEMENTARY-level article candidates for the Reading Club (a precocious early-elementary reader, reading at about a US grade 3 level), scouting kids' news and explainer sites (TIME for Kids Grades 3–4 and Grade 2 first; DOGOnews, NASA Space Place, Nat Geo Kids as stretch picks), never WSJ/The Economist. Use when the user says "pick an elementary article", "elementary candidates", "find something for the little ones", or "what could the first grader read". Checks reachability, reads each candidate in full, MEASURES its reading level and length with an in-browser readability check, and proposes five ranked picks. Recommendation only: there is no elementary track on the site yet, so nothing is authored, captured, or deployed.
---

# Reading Club — pick an ELEMENTARY article (experimental)

You are scouting **kids' news and explainer sites** for a possible third Reading Club track. The reader is a **precocious first grader reading at about a US grade 3 level** (ages 6 to 8, sharp, curious, still an early reader). The junior track (grades 5–7, The Economist) is too hard for them because the *source text* is: no handout can carry a grade-3 reader through Economist prose. So this track's whole idea is **source text that is already written at their level**, with the club's normal handout format on top.

**Status: experimental.** The owner wants to see this skill's picks before any track exists. You **only recommend**: no content files, no captures, no Blob uploads, no deploys, no votes. Present the five picks and stop.

## Who this is for (the calibration)

- **Reading level:** roughly grade 2–4 text. Short sentences (aim under ~13 words on average), mostly one- and two-syllable words, one idea per paragraph, concrete nouns. A few new words are the point (the handout teaches three), but a paragraph that stacks several unknown words is a pass.
- **Length:** **150–600 words** is the sweet spot; **800 is the hard ceiling**. Under ~120 words is usually too thin to support three vocab words and a concept.
- **Story over argument:** an animal, a kid who did something, a discovery, how a thing works, a holiday's origin, a record broken. Avoid opinion/debate pieces, policy, money/markets, and anything that needs a backdrop the reader can't have (elections are fine *only* when the article itself explains what voting is).
- **Appropriateness is a 6-year-old's parent's call.** Stricter than junior: no violence, war, crime, disasters with casualties, death as the focus, scary health topics, or bleak news. A storm piece about how storms work is fine; one about a town's losses is not. When in doubt, leave it out.
- **Handout fit:** the eventual handout needs **3 words** in a grade-3 "stretch" register (*curious, cramped, unique, gather, enormous, protect, rare, journey*; not *sight*-level words, not middle-school ones) and **at most 1 concept** (a durable piece of the world the article leans on: what a national park is, what gravity does, what a habitat is). Name both for every pick.

## Sources (verified reachable without a login, 2026-11)

### Tier 1: native level, scout these first
- **TIME for Kids, Grades 3–4 edition**: `https://www.timeforkids.com/g34/` (index, paginated `/g34/page/2/`…; topic hubs at `/g34/topics/<animals|science|space|history|…>/`). Current news written for this band. Article URLs look like `/g34/<slug>/`. Body container: `.article-show__content-article`.
- **TIME for Kids, Grade 2 edition**: `https://www.timeforkids.com/g2/`. Easier and shorter (often ~100–200 words). Good when the G3–4 field is thin or too hard this week; check it isn't too short to build a handout on.
- **Twin editions:** TFK often runs the same story in both editions (e.g. Route 66: `/g34/miles-of-history-g3/` at ~520 words and `/g2/historic-route-g2/` at ~280). When a pick has a twin, list both with their measurements so the owner can choose the level.
- **Power words:** TFK marks its own glossary words inline (`.powerword`, definition hidden in a `.definition` span). They're the editors' signal for what a reader at this level won't know: a good starting list for the three handout words, though not binding.
- TFK also has a K–1 edition (`/k1/`); below this reader, don't use it. Some TFK pieces may be subscriber-only: if the body is truncated or shows a subscribe/log-in prompt, skip the piece (never try to log in). Many short pieces (news briefs under ~120 words) are too thin; skip them.

### Tier 2: stretch picks (measure about a grade above Tier 1; pick only the plainest pieces)
- **DOGOnews**: `https://www.dogonews.com/` (daily kids' news; article URLs `/YYYY/M/D/<slug>`). Typically measures ~6–7 on the check below; take one only when it's unusually plain and the story is irresistible.
- **NASA Space Place**: `https://spaceplace.nasa.gov/` (evergreen space and Earth science explainers, e.g. `/black-holes/en/`). Public-domain, great topics, measures ~6–7.
- **National Geographic Kids**: `https://kids.nationalgeographic.com/` (animals, nature, history explainers). Unmeasured so far; run the check.

### Ruled out (don't spend time on these)
- **Wonderopolis**: shut down (the domain redirects to a closure notice).
- **Newsela, The Week Junior, Britannica Kids**: paywalled.
- **Science News Explores, Frontiers for Young Minds**: written for ages 9–15; above this reader.
- **WSJ / The Economist**: the whole reason this track exists.

## Measure every candidate (required)

Eyeballing reading level is unreliable, so **measure every piece you propose** in the Playwright browser (`mcp__plugin_playwright_playwright__browser_navigate` then `browser_evaluate` with this function). It finds the page's main paragraph block (the element holding the most `<p>`s), then reports word count, average sentence length, and a Flesch–Kincaid grade:

```js
() => {
  const counts = new Map();
  document.querySelectorAll('p').forEach(p => { if (p.innerText.trim().split(/\s+/).length > 3) counts.set(p.parentElement, (counts.get(p.parentElement) || 0) + 1); });
  const found = document.querySelector('.article-show__content-article') || [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!found) return { error: 'no paragraph block found' };
  const body = found.cloneNode(true);
  const powerWords = [...body.querySelectorAll('.powerword .title')].map(e => e.textContent.trim());
  body.querySelectorAll('.definition, figcaption, .wp-caption-text').forEach(e => e.remove());
  const paras = [...body.querySelectorAll('p')].map(p => p.textContent.replace(/\s+/g, ' ').trim()).filter(t => t.split(/\s+/).length > 3);
  const text = paras.join(' ');
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  const sentences = Math.max(1, (text.match(/[.!?]+["”’)]*(\s|$)/g) || []).length);
  const syl = w => { w = w.toLowerCase().replace(/[^a-z]/g, ''); if (w.length <= 3) return 1; w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, ''); const m = w.match(/[aeiouy]{1,2}/g); return m ? m.length : 1; };
  const sy = words.map(syl), wps = words.length / sentences, spw = sy.reduce((a, b) => a + b, 0) / words.length;
  return { title: document.title, words: words.length, wordsPerSentence: +wps.toFixed(1), fkGrade: +(0.39 * wps + 11.8 * spw - 15.59).toFixed(1), hardWordPct: +(100 * sy.filter(n => n >= 3).length / words.length).toFixed(1), powerWords, paywallHint: /subscribe|log in to read|sign in to read/i.test(body.textContent), opening: paras.slice(0, 2).join(' ').slice(0, 400) };
}
```

The hidden TFK definitions are stripped before measuring (left in, they inflate the word count and grade). Photo captions that are plain `<p>`s (TFK's ALL-CAPS-lead captions like "DRONE SHOT This view…") still slip in; they shift the numbers only slightly.

**Measuring many pieces at once.** Rather than navigating to each article, navigate to one page on the source (e.g. the TFK index) and run an `async` `browser_evaluate` that `fetch`es each same-site article URL, parses it with `DOMParser`, and applies the same steps to the parsed document. One call measures a dozen pieces. Fetch only same-origin URLs from that page.

**Reading the number.** This formula runs about **one grade high** on kids' text (and proper names inflate it). Calibration, measured 2026-11 with the stripping above: TFK Grade 2 ≈ 2.6–4.7 (most ~3.5–4), TFK Grades 3–4 ≈ 3.6–7.0 (most ~4.8–6.0), DOGOnews ≈ 6.6, NASA Space Place ≈ 6.9. So:
- **≤ 5.5 measured**: on level. Preferred.
- **5.5–6.5**: acceptable if the sentences are short and the hard words are names or the very words the handout would teach.
- **> 6.5**: a stretch pick; at most one in the five, and say so.

The number is a guard rail, not the judge: read the opening paragraphs yourself and ask whether a bright 7-year-old reading at grade 3 could get through it with three words explained. If the extractor grabbed the wrong block (word count wildly off, `opening` isn't the article), fix the selector for that page and re-run before reporting.

## Workflow

1. **Exclude what's been used.** There is no elementary track yet, so there's nothing on the site to exclude. If the owner has named pieces they already tried with the reader, exclude those. (Once a track exists, this step becomes a grep of its content dir for `articleUrl`.)
2. **Gather a pool of ~10–12** from Tier 1 first (TFK G3–4 index pages 1–2 plus a topic hub or two; TFK G2 index), then 2–3 Tier-2 stretch candidates. Prefer the last few weeks for news pieces; evergreen explainers have no date pressure. Skip on headline alone anything that fails the appropriateness or topic rules.
3. **Read and measure each.** For every candidate you might propose: open it, run the measurement, and read the body. Jot words, measured grade, the 3 words, the 0–1 concept, and a one-line verdict. Drop anything truncated or paywalled, over 800 words, too thin, or too hard; replace from the pool until you have five genuinely read and measured pieces.
4. **Propose five, ranked.** A table: rank, source, linked title, words, measured grade, the three words, the concept (or "none"), and a one-line verdict. Aim for **variety of topic** (not five animal stories) and at least one evergreen explainer. Then expand the **#1 pick**: why a grade-3 reader can follow it, what the handout would teach, and anything to watch for. Note anything you dropped and why (paywall, too hard, too grim), since what fails tells the owner as much as what passes.
5. **Close the browser** (`browser_close`) and stop. The owner judges the picks; nothing else happens until they decide to build the track.

## Publishing a pick to /kids (experimental track)

Only when the owner picks one and asks to publish it. The kids track (`lib/track.ts`) is the junior flow with `kids` in place of `junior` everywhere — follow `wsj-reading-junior`'s steps 3–8 with these differences:

- **Calibration:** exactly 3 words in the grade-3 stretch register named above, **at most 1 concept** (often the article's one durable idea, e.g. what a species is), 5 multiple-choice questions a 7-year-old can read. Short sentences everywhere, literal language, no em dashes, no markdown bold. Get the owner's sign-off on the words + concept first, as in junior.
- **Paths:** `content/kids/<date>.json`, `public/articles/kids/<date>.html`, `article-text/kids/<date>.txt`, `public/glossaries/kids/<date>.json`, `public/audio/kids/<date>/`; every script takes `--track=kids` (or the `kids/<date>` name for the glossary scripts). `source` is the site's name (e.g. "TIME for Kids"); `articleUrl` is the clean URL (drop TFK's `?rl=` param).
- **Capturing a TIME for Kids page:** before the shared snippet, run one `browser_evaluate` that rewraps each `.article-show__content-article > .image` div into a `<figure>` (its `<img>` plus a `<figcaption>` from the following `p.caption`, and removes the trailing `<cite>` credit), then set `window.__captureOpts` with `back: '/kids'`, `sourceName: 'TIME for Kids'`, `container: '.article-show__content-article'`, `strip: '.powerword .definition'`. Without the rewrap the photos are lost; without `strip` TFK's hidden definitions leak into the tutor's text. Check the text file has no "(noun)"/"(adjective)" fragments.
- **Glossary register:** grade 2–4 — gloss everyday-but-unfamiliar words, sense traps ("dove" = went under water), and every proper noun a 7-year-old needs (~35–45 entries per ~550 words).
- Ship as usual (commit + push = deploy); the page lives at `/kids/reading/<date>`. Nothing links there, so share the URL with the owner.
