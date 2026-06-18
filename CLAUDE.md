@AGENTS.md

# WSJ Reading Club

A daily reading-handout website for a small club of four kids in US grades 8–10. Each day = one Wall Street Journal article turned into a study handout with two sections — **Words to know** and **Concepts behind the story** — plus a **self-quiz** on its own page. Goal: build general knowledge, vocabulary, and conceptual understanding.

Live: https://wsjclub.vercel.app · Repo: https://github.com/cosmic-glitch/wsj_club

## Working agreement (read this first)

- **Commit and push every logical change.** Whenever the user asks for a substantive change — a feature, a content edit, a layout/UX change, a skill change — finish the task by committing and `git push`-ing to `main`. A push auto-deploys to Vercel, so **pushing is shipping**; don't leave requested changes sitting uncommitted. (Throwaway experiments are the only exception.)
- **Keep this file current.** When a change alters anything documented here — the architecture, the content schema, the daily workflow, deployment, or the file layout — update `CLAUDE.md` as part of that same change, not afterward.

## Architecture

Next.js app (App Router, Next 16, React 19, Tailwind v4). The daily content is **data, not code**: one JSON file per day in `content/`. The content pages (index, handout, quiz) are **statically generated** — adding a day = adding one JSON file. The **voice-quiz feature** (see below) adds a handful of **dynamic server routes** (login, token minting, report card) and an admin page, so the app is no longer purely static, but every content page still prerenders.

```
content/YYYY-MM-DD.json           one file = one day's handout
public/pdfs/YYYY-MM-DD.pdf        served PDF of that day's article (the "PDF" link)
PDFs/                             manual-fallback drop-zone for raw WSJ PDF exports (gitignored)
app/page.tsx                      index: one panel per day (date · title · 4 steps)
app/reading/[date]/page.tsx       one day's handout — words + concepts (+ voice-quiz at the bottom)
app/reading/[date]/quiz/page.tsx  that day's self-quiz, on its own page
app/admin/page.tsx                login-gated list of saved voice-quiz transcripts + report cards
app/api/login|logout|me/route.ts  password login → signed cookie; /me reports login state
app/api/realtime-session/route.ts mints the OpenAI Realtime ephemeral key (login-gated)
app/api/quiz-report/route.ts      grades a finished transcript → report card, saves to Blob
components/Quiz.tsx                interactive client-side self-quiz
components/VoiceQuiz.tsx           the "Quiz me out loud" WebRTC voice client (bottom of handout)
components/AuthControl.tsx         header login/logout control
lib/content.ts                    content types + loader + date helpers (the schema)
lib/auth.ts                       login auth: bcrypt-hash verify + signed-cookie helpers
lib/quiz-prompt.ts                builds the tutor's instructions + report prompt from a day's content
scripts/hash-password.mjs         CLI: bcrypt-hash logins -> base64 AUTH_USERS value
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

## Voice quiz (beta)

A "Quiz me out loud" feature that automates the teacher's 1-1 oral quiz: a student clicks it at the bottom of a handout and an AI tutor (OpenAI **Realtime API**, speech-to-speech over **WebRTC**) quizzes them aloud about that day's article, then a report card is generated and saved. It's deliberately tucked at the bottom of the handout during testing.

- **Auth gates it.** The whole site is public to browse, but starting a quiz requires login (a header **Log in** control). This is what stops the public from running up OpenAI charges. Credentials live in the `AUTH_USERS` env var: **base64-encoded JSON `{ username: bcryptHash }`**. Passwords are stored only as **bcrypt hashes** (bcryptjs, 10 salt rounds — same scheme as the foliotracker project), never plaintext, never in source; if `AUTH_USERS` is unset there are no users and **nobody can log in (fail closed)**. (Base64 because bcrypt hashes contain `$`, which Next's `.env` loader would expand.) Generate/extend the value with `node scripts/hash-password.mjs <user> <password> …` and set it as the env var. Login sets a signed httpOnly cookie (HMAC with `AUTH_SECRET`). To onboard the four real students, just regenerate `AUTH_USERS` with their names/passwords — no code change. `lib/auth.ts` is the auth core; `app/api/login|logout|me`.
- **The flow** (`lib/quiz-prompt.ts`, `buildInstructions`): greet by name → ask the student to explain the article's **key ideas** → **vocabulary** (meaning or use-in-a-sentence for each of the 3 words) → **concepts** from the handout → short encouraging wrap-up. The day's vocab/concept *meanings* are injected as the tutor's answer key. A high-level **style guide** (Socratic, one question at a time, hint-don't-reveal, stay on-article) lives in `STYLE_GUIDE` in that file — tune it there.
- **How it connects.** `components/VoiceQuiz.tsx` (client) picks the student's name, POSTs to `app/api/realtime-session` (which checks login, builds the instructions, and mints a short-lived OpenAI **ephemeral key** — the real `OPENAI_API_KEY` never reaches the browser), then opens a WebRTC session straight to OpenAI. On "End quiz" it POSTs the transcript to `app/api/quiz-report`, which grades it into a report card (a text model) and saves the whole session (transcript + report) to **Vercel Blob** under `quiz-sessions/<date>/`.
- **Reviewing results.** `/admin` (login-gated) lists every saved session newest-first with score, report card, and full transcript.
- **Models/voice** are env-overridable in case OpenAI renames them: `REALTIME_MODEL` (default `gpt-realtime-2`), `REALTIME_VOICE` (default `marin`), `REPORT_MODEL` (default `gpt-4o-mini`). These exact values were confirmed working against OpenAI's API this build.
- **Status (beta, still testing).** The backend is verified end-to-end on both local and production: login, ephemeral-token minting (OpenAI accepts `gpt-realtime-2` + `marin`), report-card generation (`gpt-4o-mini`), Blob save, and `/admin` listing all work. It's smoke-testable without a browser by POSTing to `/api/login` then `/api/realtime-session` (and `/api/quiz-report` with a fake transcript). **The one piece not yet human-tested is the in-browser microphone → tutor-audio WebRTC round-trip** — confirm that in a real browser: log in, open a handout, scroll to the bottom → "Quiz me out loud". A single `test` login is configured for this (password is NOT stored in the repo — rotate/add users via `scripts/hash-password.mjs`).

## Daily workflow

Two skills, two steps, with the user as the validation layer between them:

1. **`wsj-pick-article`** — run first each day ("pick an article", "what should we read today"). Checks `content/` for recently covered domains (quality and learning value come first; variety across days is a preference, used as a tiebreaker), browses the wsj.com homepage, verifies candidates are substantive text articles (not video-led pages or live blogs), and recommends a ranked top pick plus 2–3 runners-up. It only recommends — the **user** checks the suggestions and picks one.
2. **`wsj-reading`** — invoked with the chosen link (or when the user pastes any WSJ link / says "today's reading"). It reads the article in the browser (the user logs into WSJ themselves), then **proposes the 3 vocab words and 3–5 concepts and waits for the user's explicit go-ahead before generating anything** (a manual quality gate — the selection is discussed and revised first), writes `content/YYYY-MM-DD.json`, **captures the day's PDF directly from the open page** (`page.pdf()` → `public/pdfs/YYYY-MM-DD.pdf`, setting `pdfUrl`; the `PDFs/` drop-zone is now only a manual fallback) — capturing **text-focused** (isolate the `<article>`, drop images, `printBackground:false`) so the file stays ~100KB rather than tens of MB, because Chromium's print path otherwise embeds every photo at full `srcset` resolution (the SKILL.md has the exact snippet) — then builds, commits, and pushes (which deploys).

Audience calibration lives in both skills; the article-first content rules live in `.claude/skills/wsj-reading/SKILL.md`. Hard rule: link to WSJ and quote only short phrases — never republish the article text.

## Deploy

GitHub `cosmic-glitch/wsj_club` (public) → Vercel project `wsj_club` (team *Anurag's projects*). **Push to `main` auto-deploys to production** at `wsjclub.vercel.app` — no manual `vercel --prod` needed. `npm run build` validates every content JSON locally.

**Env vars** (for the voice quiz — set in Vercel project settings, and locally in the gitignored `.env.local`): `OPENAI_API_KEY` (required), `AUTH_USERS` (base64 bcrypt logins — see Voice quiz above; no login works without it), `AUTH_SECRET` (a long random string), `BLOB_READ_WRITE_TOKEN` (auto-added when a Vercel Blob store is linked; `vercel env pull` to get it locally), and optionally `REALTIME_MODEL`, `REALTIME_VOICE`, `REPORT_MODEL`. The voice quiz is inert (returns a clean error) until `OPENAI_API_KEY` is set; saving to Blob is best-effort and won't break a session if `BLOB_READ_WRITE_TOKEN` is missing.

**Already provisioned in Vercel** — no need to re-do setup: `OPENAI_API_KEY`, `AUTH_USERS`, and `AUTH_SECRET` are set for **Production + Preview** (marked *sensitive*, so they're intentionally absent from the Development scope and from `vercel env pull`), and a linked Blob store **`wsj-club-quizzes`** supplies `BLOB_READ_WRITE_TOKEN` to all environments. The working copies also live in the local gitignored `.env.local`. For a fresh checkout, recreate `.env.local` by hand (the sensitive values aren't pullable) — at minimum `OPENAI_API_KEY`, `AUTH_SECRET`, an `AUTH_USERS` from the hash script, and `BLOB_READ_WRITE_TOKEN` (pullable via `vercel env pull`).

## Commands

- `npm run dev` — local dev at http://localhost:3000
- `npm run build` — production build (also validates all content files)
