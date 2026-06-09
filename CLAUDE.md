@AGENTS.md

# WSJ Reading Club

A daily reading-handout website for a small club of four kids in US grades 8–10. Each day = one Wall Street Journal article turned into a study page with three sections: **Words to know**, **Concepts behind the story**, and a **self-quiz**. Goal: build general knowledge, vocabulary, and conceptual understanding.

Live: https://wsjclub.vercel.app · Repo: https://github.com/cosmic-glitch/wsj_club

## Working agreement (read this first)

- **Commit and push every logical change.** Whenever the user asks for a substantive change — a feature, a content edit, a layout/UX change, a skill change — finish the task by committing and `git push`-ing to `main`. A push auto-deploys to Vercel, so **pushing is shipping**; don't leave requested changes sitting uncommitted. (Throwaway experiments are the only exception.)
- **Keep this file current.** When a change alters anything documented here — the architecture, the content schema, the daily workflow, deployment, or the file layout — update `CLAUDE.md` as part of that same change, not afterward.

## Architecture

Static Next.js app (App Router, Next 16, React 19, Tailwind v4). The daily content is **data, not code**: one JSON file per day in `content/`. Pages render whatever files exist; the index builds itself. Adding a day = adding one JSON file.

```
content/YYYY-MM-DD.json       one file = one day's handout
app/page.tsx                  index: 3-column table (Date · Article · Handout)
app/reading/[date]/page.tsx   one day's handout (statically generated)
components/Quiz.tsx            interactive client-side quiz
lib/content.ts                content types + loader + date helpers (the schema)
.claude/skills/wsj-reading/    the skill that produces a day's content
```

## Content schema (`lib/content.ts`)

A `Reading` = `{ date, title, articleUrl, source?, vocab[], concepts[], quiz[] }`.

- **vocab** — exactly **3** `VocabWord`s, each presented *article-first*:
  `articleQuote` (short real quote from the article) → `inContext` (what it means there) → `meaning` (broader definition) → `examples` (exactly **2** more example sentences).
- **concepts** — 3–5 `Concept`s, same article-first shape:
  `articleQuote` → `inContext` → `meaning` (how it actually works).
- **quiz** — exactly **5** `QuizQuestion`s, each `{ question, options (4), answerIndex (0-based), explanation }`.

Handout pages stay brief: prominent date + title + WSJ link, then the three sections. No summary/blurb, no reading-time estimate.

## Daily workflow

Driven by the **`wsj-reading` skill** — invoked when the user pastes a WSJ link or says "today's reading". It reads the article in the browser (the user logs into WSJ themselves), writes `content/YYYY-MM-DD.json`, builds, commits, and pushes (which deploys). Audience calibration and the article-first rules live in `.claude/skills/wsj-reading/SKILL.md`. Hard rule: link to WSJ and quote only short phrases — never republish the article text.

## Deploy

GitHub `cosmic-glitch/wsj_club` (public) → Vercel project `wsj_club` (team *Anurag's projects*). **Push to `main` auto-deploys to production** at `wsjclub.vercel.app` — no manual `vercel --prod` needed. `npm run build` validates every content JSON locally.

## Commands

- `npm run dev` — local dev at http://localhost:3000
- `npm run build` — production build (also validates all content files)
