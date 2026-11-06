// The two indexes (/ and /junior). No SiteHeader: LandingIndex brings its own
// topline auth controls and masthead. The group decides this on the server —
// a usePathname() check broke once the root index went ISR, because its
// regeneration renders with the path "/index", not "/".
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">{children}</main>
  );
}
