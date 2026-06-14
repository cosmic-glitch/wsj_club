@AGENTS.md

# WSJ Reading Club

A daily reading-handout website for a small club of four kids in US grades 8–10. Each day = one Wall Street Journal article turned into a study handout with two sections — **Words to know** and **Concepts behind the story** — plus a **self-quiz** on its own page. Goal: build general knowledge, vocabulary, and conceptual understanding.

Live: https://wsjclub.vercel.app · Repo: https://github.com/cosmic-glitch/wsj_club

## Working agreement (read this first)

- **Commit and push every logical change.** Whenever the user asks for a substantive change — a feature, a content edit, a layout/UX change, a skill change — finish the task by committing and `git push`-ing to `main`. A push auto-deploys to Vercel, so **pushing is shipping**; don't leave requested changes sitting uncommitted. (Throwaway experiments are the only exception.)
- **Keep this file current.** When a change alters anything documented here — the architecture, the content schema, the daily workflow, deployment, or the file layout — update `CLAUDE.md` as part of that same change, not afterward.

## Architecture

Static Next.js app (App Router, Next 16, React 19, Tailwind v4). The daily content is **data, not code**: one JSON file per day in `content/`. Pages render whatever files exist; the index builds itself. Adding a day = adding one JSON file.

```
content/YYYY-MM-DD.json           one file = one day's handout
public/pdfs/YYYY-MM-DD.pdf        served PDF of that day's article (the "PDF" link)
PDFs/                             manual-fallback drop-zone for raw WSJ PDF exports (gitignored)
app/page.tsx                      index: one panel per day (date · title · 4 steps)
app/reading/[date]/page.tsx       one day's handout — words + concepts (statically generated)
app/reading/[date]/quiz/page.tsx  that day's self-quiz, on its own page
components/Quiz.tsx                interactive client-side quiz
lib/content.ts                    content types + loader + date helpers (the schema)
.claude/skills/wsj-pick-article/  the skill that scouts wsj.com and recommends the day's candidates
.claude/skills/wsj-reading/       the skill that produces a day's content
```

## Content schema (`lib/content.ts`)

A `Reading` = `{ date, title, articleUrl?, pdfUrl?, articles?, source?, vocab[], concepts[], quiz[] }`.

- **articleUrl** — the WSJ web article (the **Web** link). **pdfUrl** (optional) — a served PDF of the article, e.g. `/pdfs/2026-06-09.pdf` (the **PDF** link); omit it and only the Web link shows.
- **articles** (optional) — for **multi-article days**: bundle two or more short articles into one combined handout. It's an array of `Source` = `{ title, articleUrl, pdfUrl? }` (each article's own headline + links). When `articles` is set, the top-level `articleUrl`/`pdfUrl` are unused, the vocab/concepts/quiz are **combined** across all the articles, and each article gets its own PDF named `/pdfs/YYYY-MM-DD-1.pdf`, `-2.pdf`, … (see `content/2026-06-14.json` for the first one). Most days are single-article and just use `articleUrl`.

- **vocab** — exactly **3** `VocabWord`s, each presented *article-first*:
  `articleQuote` (short real quote from the article) → `inContext` (what it means there) → `meaning` (broader definition) → `examples` (exactly **2** more example sentences).
- **concepts** — 3–5 `Concept`s, same article-first shape:
  `articleQuote` → `inContext` → `meaning` (how it actually works).
- **quiz** — exactly **5** `QuizQuestion`s, each `{ question, options (4), answerIndex (0-based), explanation }`.

Pages stay minimal. The **index** is just a stack of panels, one per day — no other text. Each panel shows the date, the article title (plain text, **not** a link), then the same four numbered steps every day: **Read the _article_ (_PDF version_)** (two links — article → the WSJ article, PDF version → the served PDF; the "(PDF version)" only shows when `pdfUrl` is set), **Read the _handout_** (links to the handout page), **Take the _self-quiz_** (links to the quiz page), and **Schedule your _1-1 quiz_** (the "1-1 quiz" links to the Calendly booking page, https://calendly.com/cosmic-glitch/daily-quiz). On a **multi-article day** (when `articles` is set) that first step expands into one step per article — **Read the _first_ article — _Headline_ (_PDF version_)**, **Read the _second_ article — …** — where each article's own headline is the link to the WSJ article; so a two-article day shows **five** numbered steps (the handout/self-quiz/1-1 steps follow unchanged). The handout top is **just the article title** (no date), then the two sections. The self-quiz is its own page at `/reading/<date>/quiz`, topped with just the title. **Navigation is deliberately sparse:** the WSJ article link lives only on the index (inside that first step), and the only "← All readings" link is the one in the global header bar (`app/layout.tsx`) — content pages (handout, quiz) carry no inline back-link of their own. No summary/blurb, no reading-time estimate. In both vocab and concept cards the quote is labeled **"Quote from the article"**, followed by **"What it means here"** (in the article) and **"In general"** (the broader meaning).

## Daily workflow

Two skills, two steps, with the user as the validation layer between them:

1. **`wsj-pick-article`** — run first each day ("pick an article", "what should we read today"). Checks `content/` for recently covered domains (quality and learning value come first; variety across days is a preference, used as a tiebreaker), browses the wsj.com homepage, verifies candidates are substantive text articles (not video-led pages or live blogs), and recommends a ranked top pick plus 2–3 runners-up. It only recommends — the **user** checks the suggestions and picks one.
2. **`wsj-reading`** — invoked with the chosen link (or when the user pastes any WSJ link / says "today's reading"). It reads the article in the browser (the user logs into WSJ themselves), then **proposes the 3 vocab words and 3–5 concepts and waits for the user's explicit go-ahead before generating anything** (a manual quality gate — the selection is discussed and revised first), writes `content/YYYY-MM-DD.json`, **captures the day's PDF directly from the open page** (`page.pdf()` → `public/pdfs/YYYY-MM-DD.pdf`, setting `pdfUrl`; the `PDFs/` drop-zone is now only a manual fallback) — capturing **text-focused** (isolate the `<article>`, drop images, `printBackground:false`) so the file stays ~100KB rather than tens of MB, because Chromium's print path otherwise embeds every photo at full `srcset` resolution (the SKILL.md has the exact snippet) — then builds, commits, and pushes (which deploys).

Audience calibration lives in both skills; the article-first content rules live in `.claude/skills/wsj-reading/SKILL.md`. Hard rule: link to WSJ and quote only short phrases — never republish the article text.

## Deploy

GitHub `cosmic-glitch/wsj_club` (public) → Vercel project `wsj_club` (team *Anurag's projects*). **Push to `main` auto-deploys to production** at `wsjclub.vercel.app` — no manual `vercel --prod` needed. `npm run build` validates every content JSON locally.

## Commands

- `npm run dev` — local dev at http://localhost:3000
- `npm run build` — production build (also validates all content files)
