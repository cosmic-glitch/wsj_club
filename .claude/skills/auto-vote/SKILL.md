---
name: auto-vote
description: AUTONOMOUS daily vote opener for the Reading Club, run UNATTENDED from the Hetzner box by cron at 6am Pacific — NOT the interactive picker. Scouts The Economist (via the saved session in .bot/) + the enrichment pool, ranks candidates against the club's criteria WITHOUT waiting for human sign-off, opens the day's senior vote (7 news + 3 enrichment) via scripts/open-vote.mjs, and texts the owner over nanoclaw. Never uses WSJ. Do NOT invoke this by hand for the normal interactive flow — use wsj-open-vote for that; this exists so the cron can run the whole pick→vote step with no human in the loop.
---

# Reading Club — autonomous daily vote (Hetzner cron)

You are running **unattended** on the Hetzner box (the `run-auto-vote.sh` cron fired at 6am Pacific). Your job: pick the day's candidates and **open the senior vote** with no human in the loop, then text the owner. There is **no approval step** — you are both the picker and the validation layer, so apply the quality gates strictly (nobody screens the ballot before the club sees it). The vote is a soft output (worst case a weak candidate just loses, and the owner still authors the winner), but a *bad* or *inappropriate* candidate reaching the ballot is the failure to avoid.

This is the autonomous cousin of `wsj-open-vote` + `wsj-pick-article` + `wsj-pick-enrichment`. It differs in three ways: **(1) no WSJ ever** (the box is IP-blocked by WSJ; Economist is the only news source); **(2) no interactive sign-off**; **(3) browsing goes through the `.bot/` node scripts, not the Playwright MCP** (that MCP isn't available on this box). The selection *criteria* are identical — read those two picker skills for the full rationale; the gates below are the load-bearing summary.

All commands run from the repo root (`~/wsj_club`). The `.bot/` scripts must be invoked with `node --env-file=.bot/.env …` so an expired Economist session can self-refresh.

## Step 0 — Today's date and the idempotency guard

1. `TODAY="${AUTOVOTE_DATE:-$(TZ=America/Los_Angeles date +%F)}"` — the vote is **always for today** (Pacific). (`AUTOVOTE_DATE` is an override used only for a supervised manual test run; in the normal cron it is unset and today's Pacific date is used.)
2. **Bail if the work is already done** (the cron fires twice; the poll is also idempotent, but stop early to avoid wasted browsing):
   - If `content/${TODAY}.json` exists → today's senior reading is already published; a poll would be born closed. **Exit without opening or notifying.**
   - `curl -s https://dailyreadingclub.com/api/vote` → if it returns `"active": true` for a poll dated `${TODAY}`, the vote is already open. **Exit without re-opening or notifying.**
   - Only if neither is true do you proceed.

## The gates (apply to every candidate, strictly)

1. **Accessibility / prerequisite-load — a hard veto.** Could a curious 14-year-old with **no background** in the topic follow the article's *core argument*, given the handout will teach only ~3 concepts from scratch? One genuinely new hard idea = the stretch we want. A **stack of interlocking assumed concepts** (the classic example: a stablecoins piece needing reserves + lender-of-last-resort + money-supply elasticity before the point lands) = **disqualified, however brilliant or well-written.** Payload never overrides this.
2. **Appropriate for a 13-year-old.** No graphic violence, sexual content, or anything a parent would balk at. War/conflict is fine when the value is geopolitical understanding, not gore.
3. **A real, full-text article** — not a video-led page, live blog, chart-only *Graphic detail* stub, or podcast. It must carry **3 strong SAT-sweet-spot vocab words** and **3–5 teachable concepts**.
4. **Quality + articulation first**, then the standing lean toward **worldly wisdom — general knowledge, finance/markets, and modern forces, AI above all** (these may recur; don't ration them). Variety is only a mild tiebreaker.

## Step 1 — Coverage check (what's been read lately)

- `ls content/` and `grep -h '"title"' content/*.json | tail -20` to see recent readings; skim the last ~5 for their domains. Use this only to stay *aware* (a repeat domain is fine if it's the best article), never to force rotation.
- Build the enrichment **exclude-list**: `grep -rhoE '"(articleUrl|url)":\s*"[^"]+"' content/*.json` and pull the non-Economist URLs (fs.blog, ourworldindata.org, paulgraham.com, etc.). Never re-propose one of these. **Morgan Housel / Collab Fund is permanently excluded** regardless.

## Step 2 — News candidates (The Economist)

1. `node --env-file=.bot/.env .bot/scout.mjs > /tmp/econ-candidates.json` — returns `[{url, headline, section}]` swept across the homepage + main sections (it auto-refreshes the login if the session expired).
2. On the **headlines**, shortlist the **~12 most promising** against the gates above (favor Leaders/Briefing/Finance/Science/Business/International features; down-weight thin explainers and anything that looks video- or chart-led).
3. Read those ~12 in full: `node --env-file=.bot/.env .bot/read.mjs <url1> <url2> …` → `[{url,title,words,wall,text}]`. **Decide on the real text, not the headline.** For each, judge: 3 strong vocab words? 3–5 teachable concepts? **prerequisite-load gate** (the hard veto)? articulation? teen hook? appropriateness? A piece that comes back with very few words / `wall:true` is a dud — drop it and read a replacement from the shortlist, so you finish having genuinely read ~10.
4. Rank them, **recording for each a rating (1–10) and a one-line "why it fits" verdict** — the same opinionated read the interactive picker hands the owner (the concept/vocab payload, the hook, the domain, any reservation). These feed the Step 5 owner notification, so keep them as you go. Take the **top 7** as the news candidates (`kind: "news"`, `source: "Economist"`).

## Step 3 — Enrichment candidates (the broad free pool)

Scout the **enrichment layer** — durable mental-models / progress / wisdom reads — exactly as `wsj-pick-enrichment` does, but autonomously. Sources (Tier-1 first): **Farnam Street** (`fs.blog/blog/`), **Our World in Data** (`ourworldindata.org/latest`), **Paul Graham** (`paulgraham.com/articles.html`, the *shorter* essays), then occasionally **Works in Progress**, **Construction Physics**, **Wait But Why** (excerpt), and the **timeless canon** (Hamming, Feynman, Sagan, Ted Chiang, Buffett/Bezos letters).

1. Discover candidates with `WebSearch` and `WebFetch` of the hub pages (these open sources are **not** blocked and need no login).
2. **The ≤2,000-word rule is a HARD gate** (~1,000 target). Verify the count with `node --env-file=.bot/.env .bot/read.mjs <url>` (authoritative) — never eyeball near the ceiling. A great piece over the ceiling isn't a daily pick unless you can point at one self-contained excerpt.
3. Read each in full; require the enrichment DNA: **positive/constructive tone**, a **transferable mental model**, the **prerequisite-load gate**, 3 vocab words + 3–5 concepts. Exclude already-used URLs (Step 1) and Morgan Housel.
4. Take the **top 3** across a spread of sources (`kind: "enrichment"`, `source:` the source's name, e.g. `Farnam Street`, `Paul Graham`). As with news, **record a rating (1–10) and a one-line "why it fits" verdict for each** (name the mental model it teaches) — these go in the Step 5 notification.

If enrichment discovery comes up short (a source is down, too few clear the word gate), it's acceptable to open with fewer than 3 enrichment picks rather than force a weak one — but try hard for 3. News from the Economist should reliably yield 7.

## Step 4 — Write the ballot and open the vote

1. For every candidate write a **pitch**: 1–2 sentences for the kids (grades 8–10), **spoiler-free, honest, and equally enthusiastic across all candidates** (they must not steer the vote — no "my favorite", no visible ranking).
2. Write the approved 10 (or 7+N) to a temp JSON array of `{title, source, pitch, articleUrl, kind}`:
   ```bash
   # /tmp/ballot.json — 7 news (kind:"news") + up to 3 enrichment (kind:"enrichment")
   ```
3. Open the poll (senior). Use the **box-local** opener `.bot/open-vote.mjs`, **not** `scripts/open-vote.mjs`: this VM's minimal ops `.env.local` has only `SUPABASE_DB_URL` (no PostgREST keys), so the canonical script can't run here — `.bot/open-vote.mjs` mirrors its validation/slugify/upsert exactly but writes over `SUPABASE_DB_URL`:
   ```bash
   node --env-file=.env.local .bot/open-vote.mjs "${TODAY}" /tmp/ballot.json
   ```
   It refuses if `content/${TODAY}.json` exists and upserts idempotently on `(track,date)` otherwise (re-running keeps already-cast ballots for unchanged titles). Add `--dry-run` to validate without writing.
4. **Verify live:** `curl -s https://dailyreadingclub.com/api/vote` should show `"active": true` with your candidates for `${TODAY}`. If it doesn't, do **not** notify — log the failure and stop.

## Step 5 — Notify the owner (your ranked verdict, with reasoning)

Text the owner your **ranked assessment** — the opinionated field the interactive picker gives, **not** a bare title list and **not** the kids' pitches. Use the rating + "why it fits" verdict you recorded per candidate in Steps 2–3. This is the owner's whole window into your judgment (there's no interactive review), so it must explain *why*, not just *what*.

Compose one WhatsApp message (one line per candidate — mind the length; concise verdicts). **Every candidate line MUST end with its article link** so the owner can open any of them straight from the text:
- **Header:** vote is open, `${TODAY}`, and the vote link.
- **Top pick** (1–2 sentences + its link): source, title, rating, and the real case — the specific concept/vocab payload, the teen hook, the domain fit — why it's the strongest of the field.
- **News, ranked** (7 lines): `N. [source] title — R/10 — <why it fits> — <url>`.
- **Enrichment, ranked** (3 lines): same shape, naming the **mental model** each teaches, ending with the url.
- **Dropped:** one line on the notable cuts and why, so the owner sees the judgment calls.

Write the message to a temp file and send with `--file` (long, link-laden messages don't survive a giant inline shell arg):

```bash
cat > /tmp/vote-notify.txt <<'MSG'
🗳️ Reading Club vote is open — ${TODAY}
Vote: https://dailyreadingclub.com

⭐ TOP PICK [<source>] <title> (R/10)
<1–2 sentence case: why it's the best fit — concepts, hook, domain>
<url>

NEWS
1. [Economist] <title> — R/10 — <why it fits> — <url>
2. …(through 7, each with its url)
ENRICHMENT
1. [<source>] <title> — R/10 — <the model it teaches> — <url>
2. …(through 3, each with its url)

Dropped: <notable cuts + why>
MSG
node --env-file=.bot/.env .bot/notify.mjs --file /tmp/vote-notify.txt
```

(The `${TODAY}` above must be the real date — expand it when writing the file, e.g. build the text in your session and write the literal value, since the heredoc is single-quoted.)

Keep the **ballot pitches** (Step 4) exactly as written — spoiler-free and non-steering, for the kids. Your ranking and opinion live **only** in this owner notification, never on the ballot.

Then stop. Do **not** author the reading — the club votes, and the owner runs `wsj-reading` on the winner later (which closes the poll by publishing).

## Failure handling

- Any hard failure before the poll is open (scout throws, no readable news candidates, open-vote errors) → **do not notify**; write the reason to the log and exit non-zero so the cron log shows it. A silent no-vote is better than a broken or half-open ballot.
- Never publish a poll you didn't actually assemble from articles you read. No placeholder candidates.
