# Daily Reading Club

**Live:** https://dailyreadingclub.com

A daily reading handout for a small club of US grade 8–10 students. Each day we
take one Wall Street Journal article and build a study page from it:

1. **Words to know** — vocabulary worth learning, with kid-friendly definitions and examples.
2. **Concepts behind the story** — the richer ideas the article assumes (e.g. *hyperscalers*, *private credit*).
3. **Quiz yourself** — a 5-question interactive self-quiz.

The home page is an index of every reading, newest first.

## How it works

The site is a static Next.js app. **All the daily content lives in one JSON file
per day** under `content/`. The pages just render whatever files are there, and the
index builds itself — so adding a day is just adding a file.

```
content/2026-06-09.json     ← one file = one day's handout
app/page.tsx                ← the index of all readings
app/reading/[date]/page.tsx ← a single day's handout page
components/Quiz.tsx          ← the interactive quiz
lib/content.ts               ← content types + loader (the schema)
```

## Adding a new day

This is driven by the **`wsj-reading` skill** (`.claude/skills/wsj-reading/`).
Give Claude a WSJ article link and it will read the article (you log into WSJ in
the browser), generate the words/concepts/quiz, write `content/YYYY-MM-DD.json`,
build, and deploy.

To do it by hand: copy an existing file in `content/`, rename it to the new date,
and edit the fields. The shape is defined in `lib/content.ts`.

## Local development

```bash
npm run dev     # http://localhost:3000
npm run build   # production build (also validates every content file)
```

## Deploy

Static deploy to Vercel:

```bash
vercel --prod
```

(First time: run `vercel link` once to connect the project.)
