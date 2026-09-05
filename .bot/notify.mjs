// Send a WhatsApp message via nanoclaw's IPC file-drop. Nanoclaw's watcher
// polls the `main` group's messages dir (~1s), sends the text out to the given
// chat, then deletes the file. The `main` group is authorized to message any
// chat, so neither the owner's DM nor the club group needs registration.
//   node .bot/notify.mjs "your message"                    # → the owner's DM
//   node .bot/notify.mjs --to=group "your message"         # → the club group
//   node .bot/notify.mjs --file /tmp/msg.txt               # long/multi-line messages
//   echo "msg" | node .bot/notify.mjs --stdin
//
// Targets (JIDs live in the gitignored .bot/.env; run with --env-file=.bot/.env):
//   owner (default) → NANOCLAW_CHATJID   the owner's personal DM — the morning
//                     ranked field, dry-run notes, warnings
//   group           → NANOCLAW_GROUP_JID  the club's WhatsApp group — the daily
//                     "Today's article is up" line, nothing else
// If NANOCLAW_GROUP_JID is unset, a group message falls back to the owner's DM
// with a note saying so — the announcement must never vanish silently.
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
let to = "owner";
const rest = [];
for (const a of argv) {
  if (a.startsWith("--to=")) to = a.slice(5);
  else rest.push(a);
}
if (to !== "owner" && to !== "group") {
  console.error(`notify: unknown target "${to}" (owner|group)`);
  process.exit(1);
}

let TEXT;
const fileIdx = rest.indexOf("--file");
if (fileIdx !== -1 && rest[fileIdx + 1]) {
  TEXT = fs.readFileSync(rest[fileIdx + 1], "utf8").trim();
} else if (rest.includes("--stdin")) {
  TEXT = fs.readFileSync(0, "utf8").trim();
} else {
  TEXT = rest.join(" ").trim();
}
if (!TEXT) {
  console.error('usage: node .bot/notify.mjs [--to=owner|group] "message text" | --file <path> | --stdin');
  process.exit(1);
}

const OWNER_JID = process.env.NANOCLAW_CHATJID;
const GROUP_JID = process.env.NANOCLAW_GROUP_JID;
if (!OWNER_JID) {
  console.error("NANOCLAW_CHATJID not set — add it to .bot/.env and run with --env-file=.bot/.env");
  process.exit(1);
}
let CHAT_JID = OWNER_JID;
if (to === "group") {
  if (GROUP_JID) {
    CHAT_JID = GROUP_JID;
  } else {
    console.error("notify: NANOCLAW_GROUP_JID not set — sending the group message to the owner's DM instead");
    TEXT = `[meant for the club group — NANOCLAW_GROUP_JID is not set in .bot/.env]\n${TEXT}`;
  }
}

const IPC_DIR =
  process.env.NANOCLAW_IPC_DIR || "/home/av/nanoclaw/data/ipc/main/messages";

fs.mkdirSync(IPC_DIR, { recursive: true });
const file = path.join(
  IPC_DIR,
  `wsjclub-${to}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
);
fs.writeFileSync(
  file,
  JSON.stringify({ type: "message", chatJid: CHAT_JID, text: TEXT }),
);
console.error(`notify: queued → ${CHAT_JID} (${path.basename(file)})`);
