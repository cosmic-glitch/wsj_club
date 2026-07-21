import WordBank from "@/components/WordBank";

export const metadata = {
  title: "Junior Word Bank · WSJ Reading Club",
  description:
    "Your personal review list — the vocabulary words from every junior reading you've quizzed on.",
};

export default function JuniorWordBankPage() {
  return <WordBank track="junior" />;
}
