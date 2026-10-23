import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { createSession, SESSION_COOKIE } from "@/lib/server/session";

export const uniq = () => randomBytes(5).toString("hex");
export const email = (tag = "u") => `${tag}-${uniq()}@test.playtest.test`;

export async function makeUser(over: { name?: string; dev?: boolean; tester?: boolean; email?: string; pronoun?: string; unconfirmed?: boolean } = {}) {
  const user = await db.user.create({
    data: { email: over.email ?? email(), name: over.name ?? "Test Person", pronoun: over.pronoun ?? "", isDeveloper: over.dev ?? false, isTester: over.tester ?? false, emailVerifiedAt: over.unconfirmed ? null : new Date() },
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
