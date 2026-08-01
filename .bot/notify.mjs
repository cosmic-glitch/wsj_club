// Text the owner via nanoclaw's IPC file-drop. Nanoclaw's watcher polls the
// `main` group's messages dir (~1s), sends the text out to the given WhatsApp
// chat, then deletes the file. The `main` group is authorized to message any
// chat, so no registration is needed for a personal DM.
//   node .bot/notify.mjs "your message"
//   node .bot/notify.mjs --file /tmp/msg.txt      # long/multi-line messages
//   echo "msg" | node .bot/notify.mjs --stdin
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
let TEXT;
const fileIdx = argv.indexOf("--file");
if (fileIdx !== -1 && argv[fileIdx + 1]) {
  TEXT = fs.readFileSync(argv[fileIdx + 1], "utf8").trim();
} else if (argv.includes("--stdin")) {
  TEXT = fs.readFileSync(0, "utf8").trim();
} else {
  TEXT = argv.join(" ").trim();
}
if (!TEXT) {
  console.error('usage: node .bot/notify.mjs "message text" | --file <path> | --stdin');
  process.exit(1);
}

// Owner's personal WhatsApp DM — kept out of this (public) repo; set it in the
// gitignored .bot/.env as NANOCLAW_CHATJID (run callers with --env-file=.bot/.env).
const CHAT_JID = process.env.NANOCLAW_CHATJID;
if (!CHAT_JID) {
  console.error("NANOCLAW_CHATJID not set — add it to .bot/.env and run with --env-file=.bot/.env");
  process.exit(1);
}
const IPC_DIR =
  process.env.NANOCLAW_IPC_DIR || "/home/av/nanoclaw/data/ipc/main/messages";

fs.mkdirSync(IPC_DIR, { recursive: true });
const file = path.join(
  IPC_DIR,
  `auto-vote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
);
fs.writeFileSync(
  file,
  JSON.stringify({ type: "message", chatJid: CHAT_JID, text: TEXT }),
);
console.error(`notify: queued → ${CHAT_JID} (${path.basename(file)})`);
