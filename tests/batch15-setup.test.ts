import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { truncateSql } from "./global-setup";

// Batch 15 §32: the test schema is emptied at the start of every run, never the dev data.
describe("test schema cleanup", () => {
  it("only ever clears a named, non-public schema", () => {
    expect(() => truncateSql("public")).toThrow();
    expect(() => truncateSql("test; drop table x")).toThrow();
    expect(truncateSql("test")).toContain("nspname = 'test'");
    expect(truncateSql("test")).toContain("_prisma_migrations");
  });
  it("runs against the test schema", async () => {
    const [{ s }] = await db.$queryRaw<{ s: string }[]>`select current_schema() as s`;
    // (Batch 29) The schema TEST_DATABASE_URL names ("test" by default; a parallel builder uses its own, e.g. "test29"), never public.
    expect(s).toBe(new URL(process.env.DATABASE_URL ?? "").searchParams.get("schema") ?? "test");
    expect(s).not.toBe("public");
  });
});
