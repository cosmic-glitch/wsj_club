import type { Metadata } from "next";
import OwnerVote from "@/components/OwnerVote";

export const metadata: Metadata = {
  title: "Today's vote · Daily Reading Club",
  robots: { index: false },
};

// The owner's daily vote, linked from the 6am autopilot DM. A static shell;
// OwnerVote gates on the login and loads each level's live ballot.
export default function VotePage() {
  return (
    <div>
      <h1 className="mb-1 font-display text-[34px] font-normal uppercase leading-none tracking-[.01em] text-[#0a0a0a]">
        Today&rsquo;s vote
      </h1>
      <p className="mb-6 font-sans text-[14px] text-stone-600">
        Pick each level&rsquo;s reading. A tap saves it; the winners publish at 9am
        once every level has a vote (noon at the latest).
      </p>
      <OwnerVote />
    </div>
  );
}
