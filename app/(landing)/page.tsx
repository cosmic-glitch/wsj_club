import LandingIndex from "@/components/LandingIndex";
import { homeData } from "@/lib/home";

// The home page — every level on one page (the old /middle-school and
// /elementary home URLs redirect here, next.config.ts). Fully static: the
// content is files, and a publish is a deploy.
export default function Home() {
  return <LandingIndex {...homeData()} />;
}
