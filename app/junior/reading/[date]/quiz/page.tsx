import { notFound } from "next/navigation";
import { getAllReadings, getReading } from "@/lib/content";
import SelfQuiz from "@/components/SelfQuiz";

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
  if (!reading) return { title: "Quiz not found" };
  return {
    title: `Quiz · ${reading.title} · Junior · Daily Reading Club`,
    description: `Self-quiz for "${reading.title}".`,
  };
}

export default async function JuniorQuizPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const reading = getReading(date, "junior");
  if (!reading) notFound();
  return <SelfQuiz reading={reading} />;
}
