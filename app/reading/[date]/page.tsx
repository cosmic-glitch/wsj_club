import { notFound } from "next/navigation";
import { getAllReadings, getReading } from "@/lib/content";
import Handout from "@/components/Handout";

export function generateStaticParams() {
  return getAllReadings().map((r) => ({ date: r.date }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const reading = getReading(date);
  if (!reading) return { title: "Reading not found" };
  return {
    title: `${reading.title} · WSJ Reading Club`,
    description: `Words and concepts from "${reading.title}".`,
  };
}

export default async function ReadingPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const reading = getReading(date);
  if (!reading) notFound();
  return <Handout reading={reading} track="senior" />;
}
