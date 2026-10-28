import shared from "@/lib/configProblems.cjs";

/** (Batch 15 section 12) Every problem with the settings, with its plain fix (the one list in src/lib/configProblems.cjs). */
export const configProblems = (env: Record<string, string | undefined> = process.env, now = new Date()) => shared.configProblems(env, now);

/**
 * Who sees the admin dashboard's red settings box: only the owner (OWNER_EMAIL). Unset, every admin sees it, so it's never hidden. Never shown on public pages.
 */
export function seesConfigBox(u: { email: string }, env: Record<string, string | undefined> = process.env) {
  const owner = (env.OWNER_EMAIL ?? "").trim().toLowerCase();
  return !owner || u.email.toLowerCase() === owner;
}
