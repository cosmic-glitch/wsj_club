import LandingIndex from "@/components/LandingIndex";
import { getAllReadings } from "@/lib/content";

export default function Home() {
  return <LandingIndex readings={getAllReadings()} track="senior" />;
}
