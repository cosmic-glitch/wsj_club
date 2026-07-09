import type { Metadata } from "next";
import { Geist } from "next/font/google";
import AllReadingsLink from "@/components/AllReadingsLink";
import AuthControl from "@/components/AuthControl";
import { AuthProvider } from "@/components/AuthProvider";
import HeaderContainer from "@/components/HeaderContainer";
import SiteWordmark from "@/components/SiteWordmark";
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
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AuthProvider>
          <header className="border-b border-stone-200 bg-white/70 backdrop-blur">
            <HeaderContainer>
              {/* Hidden on the home page, where the giant masthead is the name. */}
              <SiteWordmark />
              <div className="flex items-center gap-4">
                <AllReadingsLink />
                <AuthControl />
              </div>
            </HeaderContainer>
          </header>
          <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
            {children}
          </main>
          <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-400">
            WSJ Reading Club · Original study material · Articles link to The Wall
            Street Journal
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
