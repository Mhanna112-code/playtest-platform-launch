import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { json, makeUser, req } from "./helpers";
import { listingBody } from "./fixtures";

// (Owner, Nov 9, §345) A new Post form starts with no category ticked; categories are saved in the CATEGORIES list's order (the tile shows the first).
const src = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");
const post = async (categories: string[]) => {
  const dev = await makeUser({ dev: true, name: "Nora Lane" });
  return json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ categories }) })));
};

describe("§345 categories", () => {
  it("the new form's empty start has no category; the chips keep the list's order", () => {
    expect(src("app/app/tests/new/page.tsx")).toContain('buildUrl: "", categories: [], devices: []');
    expect(src("app/app/tests/new/page.tsx")).not.toContain('"Productivity"');
    expect(src("app/app/tests/TestForm.tsx")).toContain("set({ categories: CATEGORIES.filter((x) => (x === o ? e.target.checked : f.categories.includes(x))) })");
  });

  it("none ticked: Post is refused with the existing line", async () => {
    const r = await post([]);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain("Tick at least one category.");
  });

  it("saved in the list's order whatever the tick order", async () => {
    const r = await post(["Social", "Game", "AI"]);
    expect(r.status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: r.body.id } })).categories).toEqual(["Game", "Social", "AI"]);
  });
});
