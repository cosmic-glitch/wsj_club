"use client";

import { useEffect, useState } from "react";

/**
 * The WSJ article link.
 *
 * On desktop it opens in a new tab, so the club page stays where it is.
 * On a phone/tablet it navigates in the *same* tab — a fresh browser tab tends
 * to suppress the OS handoff, whereas a plain top-level navigation to wsj.com
 * lets iOS/Android route the URL to the WSJ app via universal links / app
 * links. Whether the app actually opens still depends on the WSJ app being
 * installed and its "open supported links" setting being on; that part is out
 * of our hands. The back button returns to the club page either way.
 *
 * We always send `referrerPolicy="no-referrer"` so the destination never sees
 * `wsjclub.vercel.app` as the referrer. Some archive hosts (archive.ph /
 * archive.today) treat an inbound foreign referrer as a hotlink and trap the
 * request on their anti-bot "security check" spinner instead of loading the
 * article. On desktop `rel="noopener noreferrer"` already stripped it, but the
 * mobile same-tab path used to leak it — so a phone tap would hang on the
 * spinner while pasting the URL (no referrer) worked. This makes both behave
 * the same.
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
  // Default to a new tab so server render / no-JS / desktop all behave well;
  // switch to same-tab once we know we're on a touch-primary device.
  const [newTab, setNewTab] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) setNewTab(false);
  }, []);

  return (
    <a
      href={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      referrerPolicy="no-referrer"
      className={className}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
