import WordBank from "@/components/WordBank";

export const metadata = {
  title: "My Junior Word Bank · Daily Reading Club",
  description:
    "Your personal review list — the vocabulary words from every junior reading you've quizzed on.",
};

export default function JuniorWordBankPage() {
  return <WordBank track="junior" />;
}
