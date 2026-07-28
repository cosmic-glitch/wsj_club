import WordBank from "@/components/WordBank";

export const metadata = {
  title: "My Word Bank · Daily Reading Club",
  description:
    "Your personal review list — the vocabulary words from every reading you've quizzed on.",
};

export default function WordBankPage() {
  return <WordBank track="senior" />;
}
