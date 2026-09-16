import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The roster page was /admin/students before parents joined it.
    return [{ source: "/admin/students", destination: "/admin/members", permanent: true }];
  },
};

export default nextConfig;
