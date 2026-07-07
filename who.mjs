import { list } from '@vercel/blob';
// all users
const u = await list({ prefix: 'users/', limit: 1000 });
console.log('=== USERS ===');
for (const b of u.blobs) {
  try { const j = await (await fetch(b.url)).json(); console.log(j.username, '|', j.displayName, '| role:', j.role, '| teacher:', j.teacherId, '| active:', j.active); } catch {}
}
// distinct session owners
const { blobs } = await list({ prefix: 'quiz-sessions/', limit: 1000 });
const jsons = blobs.filter(b => b.pathname.endsWith('.json'));
const owners = new Set();
for (const b of jsons) { try { const s = await (await fetch(b.url)).json(); owners.add((s.loginUser||s.student||'?')); } catch {} }
console.log('=== SESSION OWNERS ===');
console.log([...owners].join(', '));
