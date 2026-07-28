import { notFound } from "next/navigation";
import { getAllReadings, getReading } from "@/lib/content";
import Handout from "@/components/Handout";

export function generateStaticParams() {
  return getAllReadings("junior").map((r) => ({ date: r.date }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const reading = getReading(date, "junior");
  if (!reading) return { title: "Reading not found" };
  return {
    title: `${reading.title} · Junior · Daily Reading Club`,
    description: `Words and concepts from "${reading.title}".`,
  };
}

export default async function JuniorReadingPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const reading = getReading(date, "junior");
  if (!reading) notFound();
  return <Handout reading={reading} track="junior" />;
}
