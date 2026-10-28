import { execSync } from "node:child_process";
import path from "node:path";

/** (pg_class, not pg_tables: this machine's cluster can't read pg_tablespace.)
 * The SQL that empties every table of one schema (except Prisma's migration list), so test data can't build up between runs. */
export function truncateSql(schema: string) {
  // Only a plain, non-public schema name: the dev data lives in "public" and is never touched (batch 15 §32).
  if (!/^[a-z_][a-z0-9_]*$/.test(schema) || schema === "public") throw new Error(`Refusing to clear schema "${schema}"`);
  return `DO $$ DECLARE t text; BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ') INTO t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${schema}' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations';
  IF t IS NOT NULL THEN EXECUTE 'TRUNCATE ' || t || ' RESTART IDENTITY CASCADE'; END IF;
END $$;`;
}

// Bring the test schema up to date with the migrations (creates it on the first run), then empty it (batch 15 §32: the test
// schema grew to millions of rows and the daily-job tests timed out). Every test still makes its own users with unique
// emails, so no test depends on rows from an earlier run.
export default function setup() {
  const url = process.env.VITEST_DATABASE ?? "";
  const schema = url ? new URL(url).searchParams.get("schema") : null;
  if (!url || !schema) throw new Error("No test database schema");
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  const cwd = path.resolve(__dirname, "..");
  execSync("npx prisma migrate deploy", { cwd, env, stdio: "pipe" });
  execSync("npx prisma db execute --stdin --schema prisma/schema.prisma", { cwd, env, input: truncateSql(schema), stdio: ["pipe", "pipe", "pipe"] });
}
