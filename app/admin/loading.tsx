/**
 * Instant feedback while an admin page's server render (auth + DB reads) is in
 * flight — without this, clicking Reports leaves the browser sitting on the old
 * page for the full round-trip time with nothing happening.
 */
export default function AdminLoading() {
  return (
    <p
      role="status"
      className="mt-6 animate-pulse border-[3px] border-dashed border-[#0a0a0a] bg-white p-8 text-center font-mono text-sm font-bold uppercase tracking-[.08em] text-stone-500"
    >
      Loading…
    </p>
  );
}
