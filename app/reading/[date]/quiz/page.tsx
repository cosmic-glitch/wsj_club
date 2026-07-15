import { notFound } from "next/navigation";
import { getAllReadings, getReading } from "@/lib/content";
import SelfQuiz from "@/components/SelfQuiz";

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
  if (!reading) return { title: "Quiz not found" };
  return {
    title: `Quiz · ${reading.title} · WSJ Reading Club`,
    description: `Self-quiz for "${reading.title}".`,
  };
}

export default async function QuizPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const reading = getReading(date);
  if (!reading) notFound();
  return <SelfQuiz reading={reading} />;
}
