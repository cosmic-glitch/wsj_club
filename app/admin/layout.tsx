/**
 * The admin routes (Scores + Manage Students) show data-dense tables — most
 * notably the by-article Quiz-sessions table, whose per-attempt line has five
 * sub-columns plus the three Details links (Recording · Transcript · Feedback).
 * That is wider than the site-wide `max-w-3xl` reading column, so the last
 * column was clipped on desktop at every window width.
 *
 * These pages break out of that narrow column and re-center on a wider one. The
 * `mx-[calc(50%-50vw)] w-screen` is the standard full-bleed: it escapes the
 * parent <main>'s max-width to span the viewport, then the inner `max-w-4xl`
 * re-centers the content at a comfortable width (with padding, so it never
 * touches the edges). The rest of the site — header, footer, reading pages —
 * stays at `max-w-3xl`; only these data pages are wider.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-[calc(50%_-_50vw)] w-screen px-4 sm:px-6">
      <div className="mx-auto max-w-4xl">{children}</div>
    </div>
  );
}
