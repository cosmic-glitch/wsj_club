// Shared browser helpers for the autonomous vote bot (Hetzner-only).
// Uses the local Playwright (.bot/node_modules) + the saved Economist session
// (.bot/econ-state.json). The Playwright MCP the manual skills use is NOT
// available on this box, so all browsing here goes through these deterministic
// node scripts instead.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STATE_PATH = path.join(HERE, "econ-state.json");

// Two things are load-bearing against the Economist's bot challenge, and both
// were learned the hard way (2026-08-27, after three days of failed runs):
//
//   1. NO spoofed user-agent. A UA claiming Windows/Chrome contradicts the
//      client hints the real browser sends (Sec-CH-UA-Platform and friends —
//      the challenge response literally lists them in `critical-ch`), and
//      Cloudflare fails the mismatch every time. The native UA passes.
//   2. HEADED, not headless. Headless never solves the JS challenge no matter
//      the UA. Under cron there is no display, so the entrypoint wraps the run
//      in `xvfb-run`; `launch()` goes headed whenever a DISPLAY exists and
//      falls back to headless rather than failing to start when it doesn't.
//
// Neither the IP nor the credentials were ever the problem: the same headless
// run is blocked from a residential IP too, and the saved session still reads
// full articles (721 words vs a 136-word logged-out teaser) once headed.
const CONTEXT_OPTS = {
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  timezoneId: "America/New_York",
};

export function launch() {
  return chromium.launch({
    headless: !process.env.DISPLAY,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
}

// A context that carries the saved login session, if one exists.
export async function contextWithSession(browser) {
  const opts = { ...CONTEXT_OPTS };
  if (fs.existsSync(STATE_PATH)) opts.storageState = STATE_PATH;
  return browser.newContext(opts);
}

// Read an article body as plain text + a word count. Works for the Economist
// (client-rendered body) and for open sources alike.
export async function extractArticle(page) {
  return page.evaluate(() => {
    const sel = 'article p, [data-component="paragraph"], #postBody p, .post__content p, main p, font';
    const ps = Array.from(document.querySelectorAll(sel))
      .map((p) => p.innerText.trim())
      .filter(Boolean);
    const text = ps.join("\n\n");
    const words = text ? text.split(/\s+/).length : 0;
    const wall =
      /subscribe to (read|continue)|to continue reading|sign in to continue|register to keep reading/i.test(
        document.body.innerText,
      );
    return { title: document.title, paras: ps.length, words, text, wall };
  });
}

// Is this Economist page showing subscriber (logged-in) state? Logged-out, the
// body renders only a ~7-paragraph teaser; logged-in unlocks the full article.
export async function isEconSubscriber(page) {
  return page.evaluate(() =>
    /\b(my account|log ?out|manage your account)\b/i.test(document.body.innerText),
  );
}

// Log into the Economist with .env creds and overwrite econ-state.json.
// Returns true on confirmed success. Needs ECON_EMAIL / ECON_PASS in the
// environment (run the caller with `node --env-file=.bot/.env ...`).
export async function loginAndSave() {
  const EMAIL = process.env.ECON_EMAIL;
  const PASS = process.env.ECON_PASS;
  if (!EMAIL || !PASS) {
    console.error("refresh: ECON_EMAIL / ECON_PASS not set (run with --env-file=.bot/.env)");
    return false;
  }
  const browser = await launch();
  try {
    const ctx = await browser.newContext(CONTEXT_OPTS);
    const page = await ctx.newPage();
    await page
      .goto("https://www.economist.com/api/auth/login", { waitUntil: "networkidle", timeout: 60000 })
      .catch(() => {});
    await page.waitForTimeout(6000);

    // Dismiss the cookie-consent overlay if present.
    for (const s of [
      "#onetrust-accept-btn-handler",
      'button:has-text("Accept All")',
      'button:has-text("Accept all")',
      'button:has-text("I Accept")',
    ]) {
      const b = page.locator(s).first();
      if ((await b.count()) && (await b.isVisible().catch(() => false))) {
        await b.click().catch(() => {});
        await page.waitForTimeout(1200);
        break;
      }
    }

    // The login is a Salesforce SPA; fields live in shadow DOM. Playwright
    // locators pierce open shadow DOM, so target them directly.
    const email = page
      .locator('input[type="email"], input[name="username"], input[name*="mail" i], input[autocomplete="username"]')
      .first();
    await email.waitFor({ state: "visible", timeout: 20000 });
    await email.fill(EMAIL);
    await page.waitForTimeout(600);

    let pass = page.locator('input[type="password"]').first();
    if (!(await pass.isVisible().catch(() => false))) {
      const cont = page
        .locator('button:has-text("Continue"), button:has-text("Next"), button[type="submit"]')
        .first();
      if (await cont.count()) {
        await cont.click().catch(() => {});
        await page.waitForTimeout(4000);
      }
    }
    pass = page.locator('input[type="password"]').first();
    await pass.waitFor({ state: "visible", timeout: 15000 });
    await pass.fill(PASS);

    await page
      .locator('button:has-text("Log in"), button:has-text("Sign in"), button[type="submit"]')
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(9000);

    // Confirm by reading a real article in full. Try several: any single
    // article can draw a bot challenge, and judging the login on one unlucky
    // pick is what produced three days of bogus "check credentials" alerts.
    await page.goto("https://www.economist.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    const arts = await page.evaluate(() => {
      const seen = new Set();
      return Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.href)
        .filter((h) => /economist\.com\/[a-z-]+\/20\d\d\/\d{2}\/\d{2}\/[a-z0-9-]+/i.test(h))
        .filter((h) => (seen.has(h) ? false : (seen.add(h), true)))
        .slice(0, 4);
    });
    let ok = false;
    let best = 0;
    let challenged = false;
    for (const art of arts) {
      await page.goto(art, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(3500);
      const { words } = await extractArticle(page);
      // A solved page renders the headline; a challenge leaves a stub title.
      if (words === 0 && /^(economist\.com|just a moment)/i.test(await page.title())) challenged = true;
      best = Math.max(best, words);
      if (words > 400) {
        ok = true;
        break;
      }
    }
    if (ok) {
      await ctx.storageState({ path: STATE_PATH });
      console.error("refresh: login OK, session saved");
    } else if (challenged || best === 0) {
      // Distinguish a bot block from a genuine auth failure — they need
      // completely different fixes, and only one of them is about the password.
      console.error(
        `refresh: login NOT confirmed — bot challenge, not credentials (read ${arts.length} articles, best ${best} words). ` +
          "Check that the run is headed (DISPLAY set / xvfb-run) and that no spoofed user-agent is set.",
      );
    } else {
      console.error(
        `refresh: login NOT confirmed — pages load but stay truncated (best ${best} words); this one really may be credentials or an expired subscription.`,
      );
    }
    return ok;
  } finally {
    await browser.close();
  }
}

// Ground-truth login check: open the newest homepage article and see whether
// the body is full or a logged-out teaser. Homepage header text is unreliable
// (the account control is an icon, not the words "my account"), so we measure
// what actually matters — can we read a full article.
async function canReadFullArticle(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto("https://www.economist.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    const art = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.href)
        .find((h) => /economist\.com\/[a-z-]+\/20\d\d\/\d{2}\/\d{2}\/[a-z0-9-]+/i.test(h)),
    );
    if (!art) return false;
    await page.goto(art, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    const { words } = await extractArticle(page);
    return words > 300; // logged-out teaser is ~130 words
  } catch {
    return false;
  } finally {
    await page.close();
  }
}

// Return a logged-in Economist context, refreshing the saved session first if
// we can't actually read a full article. Caller must close the returned
// context's browser (returned alongside).
export async function ensureEconSession() {
  let browser = await launch();
  let ctx = await contextWithSession(browser);
  if (await canReadFullArticle(ctx)) return { browser, ctx };

  // Logged out / expired — refresh in a separate browser, rebuild the context.
  console.error("session: can't read full articles, refreshing…");
  await browser.close();
  const ok = await loginAndSave();
  browser = await launch();
  ctx = await contextWithSession(browser);
  if (!ok) console.error("session: refresh failed; continuing logged-out (reads may truncate)");
  return { browser, ctx };
}
