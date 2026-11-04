import Link from "next/link";
import { pronouns } from "@/lib/format";

/** (Owner, Oct 28, batch 20 section 17) Shown in the normal shell instead of the bare 404: "This profile isn't available." (they blocked you; never says so) or "This page doesn't exist.". */
export const PROFILE_UNAVAILABLE = "This profile isn't available.";
export const PAGE_MISSING = "This page doesn't exist.";
/** (Batch 35 §162) In the developer's own pronoun ("her tests"). */
export const blockedTestsLine = (name: string, pronoun?: string | null) => `You blocked ${name}, so ${pronouns(pronoun).poss} tests are hidden.`;

export function ProfileUnavailable({ line = PROFILE_UNAVAILABLE }: { line?: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p><Link href="/app">← Back</Link></p>
      <p className="card note" data-profile-unavailable="">{line}</p>
    </div>
  );
}
