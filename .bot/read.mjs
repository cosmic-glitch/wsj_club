// Read one or more article URLs in full and print their body text + word count.
// Works for the Economist (via the saved session, auto-refreshing if expired)
// and for open web sources (the session cookies are harmless there).
//   node --env-file=.bot/.env .bot/read.mjs <url> [url2 ...]
// Prints a JSON array of { url, title, words, wall, text } on stdout.
import { ensureEconSession, extractArticle } from "./lib.mjs";

const urls = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (urls.length === 0) {
  console.error("usage: node --env-file=.bot/.env .bot/read.mjs <url> [url2 ...]");
  process.exit(1);
}

// Refresh once up front if the Economist session is stale; reuse the context
// for every URL (open sources ignore the cookies).
const { browser, ctx } = await ensureEconSession();
const page = await ctx.newPage();
const results = [];

for (const url of urls) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    const a = await extractArticle(page);
    results.push({ url, title: a.title, words: a.words, wall: a.wall, text: a.text });
    console.error(`read: ${a.words} words — ${url.split("/").pop()}`);
  } catch (e) {
    results.push({ url, error: String(e).split("\n")[0] });
    console.error(`read: FAILED ${url} — ${String(e).split("\n")[0]}`);
  }
}

await browser.close();
process.stdout.write(JSON.stringify(results, null, 2) + "\n");
