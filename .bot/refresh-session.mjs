// Re-login to the Economist and overwrite .bot/econ-state.json.
// Run when the saved session has expired:
//   node --env-file=.bot/.env .bot/refresh-session.mjs
// Also invoked automatically by ensureEconSession() when a scout/read finds the
// homepage logged out. Exits non-zero if the login could not be confirmed.
import { loginAndSave } from "./lib.mjs";

const ok = await loginAndSave();
process.exit(ok ? 0 : 1);
