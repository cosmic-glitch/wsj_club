import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The roster page was /admin/students before parents joined it.
    return [
      { source: "/admin/students", destination: "/admin/members", permanent: true },
      // ONE home page for every level: the per-level home URLs (and their old
      // /junior, /kids names) land on "/" with the level's tab open. Links
      // already posted in the club chat and the captured article pages' back
      // links point at these. Not permanent: browsers cache a 308 for good.
      { source: "/middle-school", destination: "/#middle-school", permanent: false },
      { source: "/elementary", destination: "/#elementary", permanent: false },
      { source: "/junior", destination: "/#middle-school", permanent: false },
      { source: "/kids", destination: "/#elementary", permanent: false },
      // The tracks' inner pages under their old slugs (the track ids are still
      // junior/kids internally; lib/track.ts).
      { source: "/junior/:path+", destination: "/middle-school/:path+", permanent: true },
      { source: "/kids/:path+", destination: "/elementary/:path+", permanent: true },
    ];
  },
};

export default nextConfig;
