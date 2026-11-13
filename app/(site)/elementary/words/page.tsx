import WordBank from "@/components/WordBank";

export const metadata = {
  title: "My Elementary Word Bank · Daily Reading Club",
  description:
    "Your personal review list — the vocabulary words from every elementary reading you've quizzed on.",
};

export default function KidsWordBankPage() {
  return <WordBank track="kids" />;
}
