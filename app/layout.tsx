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
  title: "WSJ Reading Club",
  description:
    "A daily Wall Street Journal reading handout — vocabulary, concepts, and a self-quiz to build general knowledge.",
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
          <footer className="border-t-[3px] border-[#0a0a0a] py-6 text-center font-mono text-[10px] font-bold uppercase tracking-[.14em] text-stone-500">
            WSJ Reading Club · Original study material · Articles link to The
            Wall Street Journal
          </footer>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
