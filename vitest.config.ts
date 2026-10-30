import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Tests use their own schema ("test") in the local database, never the dev data: tests/global-setup.ts
// applies the migrations to it before every run.
const env = { ...loadEnv("test", process.cwd(), ""), ...process.env };
const testDb = env.TEST_DATABASE_URL || "postgresql://postgres@localhost:5499/playtest_lite?schema=test";
const schema = new URL(testDb).searchParams.get("schema");
if (!schema || schema === "public") throw new Error("TEST_DATABASE_URL must name a separate schema (e.g. ?schema=test)");
if (!/localhost|127\.0\.0\.1/.test(new URL(testDb).hostname) && !env.CI) throw new Error("Tests only run against a local database");
process.env.VITEST_DATABASE = testDb;

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // No real emails, payments or uploads from tests. (Batch 30 §14) ANSWER_MIN_CHARS 1: the tests written before batch 30 send short answers ("a"); the batch 30
    // answer tests set it back to the real 50 (lib/questions.ts answerMin).
    env: {
      DATABASE_URL: testDb, DIRECT_URL: testDb, RESEND_API_KEY: "", EMAIL_FROM: "", STRIPE_SECRET_KEY: "", STRIPE_PUBLISHABLE_KEY: "", STRIPE_CONNECT_WEBHOOK_SECRET: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "",
      R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET: "", UPLOAD_DIR: path.resolve(__dirname, ".test-uploads"),
      ADMIN_EMAILS: "owner@playtest.test", ANSWER_MIN_CHARS: "1", SKIP_EMAIL_CONFIRM: "", APP_URL: "http://localhost:3400", STRIPE_WEBHOOK_SECRET: "whsec_test", CRON_SECRET: "cron-test",
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
