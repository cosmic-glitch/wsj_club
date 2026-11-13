import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The roster page was /admin/students before parents joined it.
    return [
      { source: "/admin/students", destination: "/admin/members", permanent: true },
      // The middle-school and elementary tracks' old URLs (the track ids are
      // still junior/kids internally; lib/track.ts). Links already posted in the
      // club chat, and the captured article pages' back links, point here.
      { source: "/junior", destination: "/middle-school", permanent: true },
      { source: "/junior/:path*", destination: "/middle-school/:path*", permanent: true },
      { source: "/kids", destination: "/elementary", permanent: true },
      { source: "/kids/:path*", destination: "/elementary/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
