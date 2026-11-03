import shared from "@/lib/configProblems.cjs";

/** (Batch 15 section 12) Every problem with the settings, with its plain fix (the one list in src/lib/configProblems.cjs). */
export const configProblems = (env: Record<string, string | undefined> = process.env, now = new Date()) => shared.configProblems(env, now);

/** (Batch 35 §135) Whether the call relay is set up: the Cloudflare TURN key (both settings) or TURN_URL. */
export const turnRelaySetUp = (env: Record<string, string | undefined> = process.env) => shared.turnRelaySetUp(env);

/**
 * Who sees the admin dashboard's red settings box: only the owner (OWNER_EMAIL). Unset, every admin sees it, so it's never hidden. Never shown on public pages.
 */
export function seesConfigBox(u: { email: string }, env: Record<string, string | undefined> = process.env) {
  const owner = (env.OWNER_EMAIL ?? "").trim().toLowerCase();
  return !owner || u.email.toLowerCase() === owner;
}
