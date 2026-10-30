import { randomBytes } from "node:crypto";
import { TERMS_VERSION } from "@/lib/termsOfUse";
import { db } from "@/lib/db";
import { createSession, SESSION_COOKIE } from "@/lib/server/session";

export const uniq = () => randomBytes(5).toString("hex");
export const email = (tag = "u") => `${tag}-${uniq()}@test.playtest.test`;

export async function makeUser(over: { name?: string; dev?: boolean; tester?: boolean; email?: string; pronoun?: string; unconfirmed?: boolean; termsVersion?: number; /** (batch 20 section 5) false: hasn't confirmed 18+ yet */ ageConfirmed?: boolean } = {}) {
  const user = await db.user.create({
    data: { email: over.email ?? email(), name: over.name ?? "Test Person", pronoun: over.pronoun ?? "", isDeveloper: over.dev ?? false, isTester: over.tester ?? false, emailVerifiedAt: over.unconfirmed ? null : new Date(), termsVersion: over.termsVersion ?? TERMS_VERSION, ageConfirmedAt: over.ageConfirmed === false ? null : new Date() },
  });
  if (over.tester) await db.testerProfile.create({ data: { userId: user.id, devices: ["Windows PC"], languages: ["English"], categories: [] } });
  const { token } = await createSession(user.id);
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

export function req(path: string, opts: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://localhost:3400" + path, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

export async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** (Batch 30 §10) A tester's one line per listing save: "Nora Lane edited the listing at 3:04 PM: description" (any time). */
export const saveRe = (who: string, rest: string, verb = "edited the listing") => new RegExp(`^${esc(who)} ${verb} at \\d{1,2}:\\d{2}\\s[AP]M${rest ? `: ${esc(rest)}` : ""}$`);
