import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WSJ Reading Club",
  description:
    "A daily Wall Street Journal reading handout — vocabulary, concepts, and a self-quiz to build general knowledge.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-stone-200 bg-white/70 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
            <Link href="/" className="font-serif text-lg font-bold tracking-tight">
              WSJ Reading Club
            </Link>
            <Link
              href="/"
              className="text-sm text-stone-500 transition hover:text-stone-900"
            >
              ← All readings
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
          {children}
        </main>
        <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-400">
          WSJ Reading Club · Original study material · Articles link to The Wall
          Street Journal
        </footer>
      </body>
    </html>
  );
}
