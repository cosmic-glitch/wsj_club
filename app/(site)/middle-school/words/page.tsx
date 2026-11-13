import WordBank from "@/components/WordBank";

export const metadata = {
  title: "My Middle School Word Bank · Daily Reading Club",
  description:
    "Your personal review list — the vocabulary words from every middle school reading you've quizzed on.",
};

export default function JuniorWordBankPage() {
  return <WordBank track="junior" />;
}
