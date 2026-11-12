import WordBank from "@/components/WordBank";

export const metadata = {
  title: "My Kids Word Bank · Daily Reading Club",
  description:
    "Your personal review list — the vocabulary words from every kids reading you've quizzed on.",
};

export default function KidsWordBankPage() {
  return <WordBank track="kids" />;
}
