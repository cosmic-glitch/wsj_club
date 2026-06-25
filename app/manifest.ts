import type { MetadataRoute } from "next";

// Web app manifest — gives non-iOS browsers (Android/Chrome) the same short
// name and icon when the site is added to a home screen. iOS gets its name
// from appleWebApp.title in app/layout.tsx and its icon from app/apple-icon.png.
// display: "browser" keeps the normal in-Safari/Chrome behavior (no forced
// full-screen standalone launch).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Reading Club",
    short_name: "Reading Club",
    description:
      "A daily Wall Street Journal reading handout — vocabulary, concepts, and a self-quiz to build general knowledge.",
    start_url: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#f43f5e",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
