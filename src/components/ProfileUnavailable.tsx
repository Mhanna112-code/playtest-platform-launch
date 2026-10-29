import Link from "next/link";

/** (Owner, Oct 28, batch 20 section 17) Shown in the normal shell instead of the bare 404: "This profile isn't available." (they blocked you; never says so) or "This page doesn't exist.". */
export const PROFILE_UNAVAILABLE = "This profile isn't available.";
export const PAGE_MISSING = "This page doesn't exist.";
export const blockedTestsLine = (name: string) => `You blocked ${name}, so their tests are hidden.`;

export function ProfileUnavailable({ line = PROFILE_UNAVAILABLE }: { line?: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p><Link href="/app">← Back</Link></p>
      <p className="card note" data-profile-unavailable="">{line}</p>
    </div>
  );
}
