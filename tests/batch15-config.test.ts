import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { configProblems, seesConfigBox } from "@/lib/server/config";
import { NO_EMAIL_KEY, sendEmail } from "@/lib/server/email";

// Batch 15 section 12: settings checked loudly (one list; a bad value stops the build; the owner's red box; production never writes to the outbox).
const NOW = new Date("2026-11-01T12:00:00Z");
const msgs = (env: Record<string, string>) => configProblems(env, NOW).map((p) => p.message);
afterEach(() => vi.unstubAllEnvs());

describe("configProblems", () => {
  it("lists each problem with its plain fix", () => {
    expect(msgs({})).toEqual([]);
    expect(msgs({ NODE_ENV: "production" })).toEqual([
      "Emails aren't being sent: RESEND_API_KEY is missing.",
      "CRON_SECRET is missing: the daily job can't run (reminders, Charge, retries).",
      "ADMIN_EMAILS is missing: nobody can open the admin console.",
      "APP_URL is missing: set it to the site's https address (links in emails and Stripe's return pages use it).",
      'STRIPE_SECRET_KEY is missing: every Pay would be recorded as "payments not set up" and testers told they were paid.',
      "The R2 settings are missing: uploads would go to the server's own disk, which Vercel doesn't keep.",
      "EMAIL_FROM is missing or a placeholder: set an address on your verified Resend domain.",
    ]);
    expect(msgs({ FREE_UNTIL: "next spring" })).toEqual([`FREE_UNTIL isn't a valid date ("next spring"). Developers stay free until it's fixed.`]);
    expect(msgs({ FREE_UNTIL: "2026-11-20" })[0]).toMatch(/^FREE_UNTIL is less than 30 days ahead/);
    expect(msgs({ FREE_UNTIL: "2026-10-01" })).toEqual([]); // a past date: free has ended, fine
    expect(msgs({ FREE_UNTIL: "2027-03-01" })).toEqual([]);
    expect(msgs({ STRIPE_SECRET_KEY: "sk_test_x" })).toHaveLength(3);
    expect(msgs({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PUBLISHABLE_KEY: "pk", STRIPE_WEBHOOK_SECRET: "a", STRIPE_CONNECT_WEBHOOK_SECRET: "b" })).toEqual([]);
    expect(msgs({ R2_BUCKET: "b" })[0]).toMatch(/^Only some R2 settings are set \(missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY\)/);
    expect(msgs({ OUTAGE_CHECKS: "1" })[0]).toMatch(/^OUTAGE_CHECKS=1 without HEALTH_KEY/);
  });
  it("only bad values stop the build; missing optional settings warn", () => {
    const stops = (env: Record<string, string>) => configProblems(env, NOW).filter((p) => p.stopsBuild).length;
    expect(stops({ FREE_UNTIL: "nope" })).toBe(1);
    expect(stops({ FREE_UNTIL: "2026-11-05" })).toBe(0);
    expect(stops({ STRIPE_SECRET_KEY: "sk_live_x" })).toBe(3);
    expect(stops({ STRIPE_SECRET_KEY: "sk_test_x" })).toBe(0);
    expect(stops({ R2_ACCOUNT_ID: "a" })).toBe(1);
    expect(stops({ NODE_ENV: "production" })).toBe(5); // (batch 15 section 41, M3) the email key, APP_URL, Stripe, R2 and EMAIL_FROM; the others warn
    expect(stops({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(0); // a preview build isn't the live site
  });
  it("the build script fails with the plain message", () => {
    const run = (env: Record<string, string>) => {
      try {
        execFileSync(process.execPath, [path.resolve(__dirname, "../scripts/check-config.cjs")], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv, stdio: "pipe", cwd: path.resolve(__dirname, "/") });
        return { code: 0, out: "" };
      } catch (e) {
        const x = e as { status: number; stderr: Buffer };
        return { code: x.status, out: x.stderr.toString() };
      }
    };
    const bad = run({ FREE_UNTIL: "2026-13-45", RESEND_API_KEY: "" });
    expect(bad.code).toBe(1);
    expect(bad.out).toContain(`FREE_UNTIL isn't a valid date ("2026-13-45"). Developers stay free until it's fixed.`);
    expect(run({ FREE_UNTIL: "2027-06-01" }).code).toBe(0);
  });
  it("(section 41, M3 and H1) fail-open production settings and placeholders stop the build", () => {
    const live = { NODE_ENV: "production", RESEND_API_KEY: "re_x", APP_URL: "https://playtest.app", STRIPE_SECRET_KEY: "sk_live_x", STRIPE_ALLOW_LIVE: "1", STRIPE_PUBLISHABLE_KEY: "pk", STRIPE_WEBHOOK_SECRET: "a", STRIPE_CONNECT_WEBHOOK_SECRET: "b", R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d", CRON_SECRET: "c", ADMIN_EMAILS: "ana@playtest.app", EMAIL_FROM: "Playtest <hi@playtest.app>", HEALTH_KEY: "k".repeat(40) };
    const stopping = (over: Record<string, string>) => configProblems({ ...live, ...over }, NOW).filter((p) => p.stopsBuild).map((p) => p.message);
    expect(stopping({})).toEqual([]);
    expect(stopping({ ALLOW_DEV_OUTBOX: "1" })[0]).toMatch(/^ALLOW_DEV_OUTBOX=1 on the live site/);
    expect(stopping({ STRIPE_FAKE: "1" })[0]).toMatch(/^STRIPE_FAKE=1 on the live site/);
    expect(stopping({ ADMIN_EMAILS: "owner@example.com" })[0]).toMatch(/^ADMIN_EMAILS still has a placeholder/);
    expect(stopping({ EMAIL_FROM: "Playtest <hello@example.com>" })[0]).toMatch(/^EMAIL_FROM is missing or a placeholder/);
    expect(stopping({ HEALTH_KEY: "change-me-long-random-secret" })[0]).toMatch(/^HEALTH_KEY is a placeholder/);
    expect(stopping({ R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET: "" })[0]).toMatch(/^The R2 settings are missing/);
    expect(stopping({ STRIPE_SECRET_KEY: "" })[0]).toMatch(/^STRIPE_SECRET_KEY is missing/);
    expect(stopping({ APP_URL: "" })[0]).toMatch(/^APP_URL is missing/);
  });

  it("the red box is the owner's; every admin sees it when OWNER_EMAIL is unset", () => {
    expect(seesConfigBox({ email: "ana@x.test" }, {})).toBe(true);
    expect(seesConfigBox({ email: "ana@x.test" }, { OWNER_EMAIL: "Owner@x.test" })).toBe(false);
    expect(seesConfigBox({ email: "owner@x.test" }, { OWNER_EMAIL: "Owner@x.test" })).toBe(true);
  });
  it("production without the email key: sendEmail throws, logs and never writes to the outbox (unless ALLOW_DEV_OUTBOX=1)", async () => {
    const to = `nobody-${Date.now()}@x.test`;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendEmail({ to, subject: "Hi", text: "x" })).rejects.toThrow(NO_EMAIL_KEY);
    expect(err).toHaveBeenCalled();
    expect(await db.outboxEmail.count({ where: { to } })).toBe(0);
    vi.stubEnv("ALLOW_DEV_OUTBOX", "1");
    expect((await sendEmail({ to, subject: "Hi", text: "x" })).via).toBe("outbox");
    err.mockRestore();
  });
});
