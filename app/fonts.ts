import { Anton, Space_Mono } from "next/font/google";

// The brutalist design's two display faces, shared by the whole site (the
// landing page introduced them; the inner pages + chrome now use them too).
// Palette that goes with them: pure white canvas, near-black #0a0a0a ink,
// signal-yellow #ffe600. The variables are attached to <html> in app/layout.tsx
// and exposed as the `font-display` / `font-mono` utilities via app/globals.css.
export const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
});

export const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
});
