import { execSync } from "node:child_process";
import path from "node:path";

// Bring the test schema up to date with the migrations (creates it on the first run). Nothing is wiped:
// every test makes its own users with unique emails, so runs never depend on or collide with earlier data.
export default function setup() {
  const url = process.env.VITEST_DATABASE ?? "";
  if (!url || !new URL(url).searchParams.get("schema")) throw new Error("No test database schema");
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "pipe",
  });
}
