// Daily Vercel Blob backup: snapshot every blob in the store to
// backups/<YYYY-MM-DD>/<pathname>, hardlinking files unchanged since the
// previous snapshot so retention costs ~one copy of the store plus deltas.
// Invoked by scripts/backup-blob.sh (which sources .env.local for
// BLOB_READ_WRITE_TOKEN and handles locking/retention).
import { list } from "@vercel/blob";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BACKUP_ROOT = path.join(PROJECT_DIR, "backups");
const CONCURRENCY = 8;

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const destDir = path.join(BACKUP_ROOT, today);
fs.mkdirSync(destDir, { recursive: true });

// Most recent prior snapshot that completed (has a manifest), for hardlinking.
const prevDate = fs
  .readdirSync(BACKUP_ROOT)
  .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== today)
  .filter((d) => fs.existsSync(path.join(BACKUP_ROOT, d, "manifest.json")))
  .sort()
  .pop();
const prevManifest = new Map();
if (prevDate) {
  const entries = JSON.parse(
    fs.readFileSync(path.join(BACKUP_ROOT, prevDate, "manifest.json"), "utf8")
  );
  for (const e of entries) prevManifest.set(e.pathname, e);
}

// Enumerate the whole store (cursor pagination).
const blobs = [];
let cursor;
do {
  const page = await list({ cursor, limit: 1000 });
  blobs.push(...page.blobs);
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

let linked = 0;
let downloaded = 0;
let failed = 0;

async function saveBlob(blob) {
  const dest = path.join(destDir, blob.pathname);
  if (path.relative(destDir, dest).startsWith("..")) {
    throw new Error(`pathname escapes snapshot dir: ${blob.pathname}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const prev = prevManifest.get(blob.pathname);
  const unchanged =
    prev &&
    prev.size === blob.size &&
    prev.uploadedAt === blob.uploadedAt.toISOString();
  if (unchanged) {
    const prevFile = path.join(BACKUP_ROOT, prevDate, blob.pathname);
    if (fs.existsSync(prevFile)) {
      if (!fs.existsSync(dest)) fs.linkSync(prevFile, dest);
      linked++;
      return;
    }
  }

  // Cache-bust: slots/users/votes are overwritten in place and the Blob edge
  // cache lags overwrites (see CLAUDE.md), so force a fresh read.
  const url = `${blob.downloadUrl}&v=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${blob.pathname}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  downloaded++;
}

const queue = [...blobs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let blob = queue.shift(); blob; blob = queue.shift()) {
      try {
        await saveBlob(blob);
      } catch (err) {
        failed++;
        console.error(`FAILED ${blob.pathname}: ${err.message}`);
      }
    }
  })
);

// Manifest last — its presence marks the snapshot complete/linkable.
const manifest = blobs.map((b) => ({
  pathname: b.pathname,
  size: b.size,
  uploadedAt: b.uploadedAt.toISOString(),
  url: b.url,
}));
fs.writeFileSync(
  path.join(destDir, "manifest.json"),
  JSON.stringify(manifest, null, 2)
);

console.log(
  `${blobs.length} blobs: ${downloaded} downloaded, ${linked} hardlinked, ${failed} failed`
);
if (failed > 0) process.exit(1);
