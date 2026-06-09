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
 */
export default function ArticleLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
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
      className={className}
    >
      {children}
    </a>
  );
}
