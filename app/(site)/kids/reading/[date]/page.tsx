import { notFound } from "next/navigation";
import { getAllReadings, getReading } from "@/lib/content";
import Handout from "@/components/Handout";

export function generateStaticParams() {
  return getAllReadings("kids").map((r) => ({ date: r.date }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const reading = getReading(date, "kids");
  if (!reading) return { title: "Reading not found" };
  return {
    title: `${reading.title} · Kids · Daily Reading Club`,
    description: `Words and concepts from "${reading.title}".`,
  };
}

export default async function KidsReadingPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const reading = getReading(date, "kids");
  if (!reading) notFound();
  return <Handout reading={reading} track="kids" />;
}
