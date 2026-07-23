/**
 * The WSJ article link.
 *
 * Always navigates in the *current* tab, on every device (owner decision,
 * 2026-07-23 — it used to open a new tab on desktop, which made desktop and
 * phone behave differently). Same-tab also lets iOS/Android route the URL to
 * the WSJ app via universal links / app links, which a fresh tab tends to
 * suppress. The back button returns to the club page.
 *
 * We always send `referrerPolicy="no-referrer"` so the destination never sees
 * `wsjclub.vercel.app` as the referrer. Some archive hosts (archive.ph /
 * archive.today) treat an inbound foreign referrer as a hotlink and trap the
 * request on their anti-bot "security check" spinner instead of loading the
 * article — a phone tap would hang on the spinner while pasting the URL (no
 * referrer) worked.
 */
export default function ArticleLink({
  href,
  className,
  children,
  onClick,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>; // e.g. stopPropagation inside a clickable card (the vote modal)
}) {
  return (
    <a
      href={href}
      referrerPolicy="no-referrer"
      className={className}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
