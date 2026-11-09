import { pronounLabel } from "@/lib/format";

/** (Owner, Nov 9, §335) The person's pronouns after their name on a profile and a name hover card ("she / her"), only when set; unset shows nothing. */
export function PronounTag({ pronoun, className = "" }: { pronoun: string | null | undefined; className?: string }) {
  const label = pronounLabel(pronoun);
  return label ? <span className={`font-normal text-slate-400 ${className}`.trim()} data-pronoun="">{label}</span> : null;
}
