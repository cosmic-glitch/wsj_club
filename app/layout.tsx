import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { AuthProvider } from "@/components/AuthProvider";
import SiteHeader from "@/components/SiteHeader";
import { anton, spaceMono } from "./fonts";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Resolves every relative URL in the metadata below (and in any page's own
  // openGraph) to an absolute one. Without it Next falls back to localhost in
  // dev and to VERCEL_URL — the per-deployment *.vercel.app hostname — in
  // production, so shared links would carry a URL that changes every deploy.
  metadataBase: new URL("https://dailyreadingclub.com"),
  title: "Daily Reading Club",
  description:
    "One hand-picked article a day — vocabulary, concepts, and an AI quiz that checks you actually read it.",
  // Link previews — handouts get pasted into the club's group chat, so the
  // title/description should render there rather than a bare URL.
  openGraph: {
    type: "website",
    siteName: "Daily Reading Club",
    url: "/",
    title: "Daily Reading Club",
    description:
      "One hand-picked article a day — vocabulary, concepts, and an AI quiz that checks you actually read it.",
  },
  // The label shown under the icon when added to an iPhone home screen.
  // capable:false keeps the normal "opens in Safari" behavior (no full-screen
  // standalone mode); we only want the short name + the apple-touch-icon.
  appleWebApp: {
    capable: false,
    title: "Reading Club",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${anton.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <AuthProvider>
          {/* Hidden entirely on the home page, which brings its own masthead
              and login controls (see SiteHeader). */}
          <SiteHeader />
          <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
            {children}
          </main>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
