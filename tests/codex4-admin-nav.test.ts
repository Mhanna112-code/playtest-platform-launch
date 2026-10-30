import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET as moreGET } from "@/app/api/admin/more/route";
import { json, makeUser, req } from "./helpers";

vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
import { requirePageUser } from "@/lib/server/page-auth";

const source = (file: string) => readFileSync(path.resolve(__dirname, "../src", file), "utf8");

describe("Task 4: admin navigation", () => {
  it("shows the four console links without Back to the app", () => {
    const nav = source("app/admin/AdminNav.tsx");
    expect(nav).toContain("href=\"/admin\"");
    expect(nav).toContain("href=\"/admin/developers\"");
    expect(nav).toContain("href=\"/admin/testers\"");
    expect(nav).toContain("href=\"/app/find\"");
    expect(source("app/admin/page.tsx")).not.toContain("Back to the app");
    expect(source("app/admin/layout.tsx")).toContain("<AdminNav />");
    expect(source("app/admin/layout.tsx")).toContain("<SignOut />");
    expect(source("app/admin/layout.tsx")).toContain('href="/app/account"');
    expect(source("app/app/layout.tsx")).toContain("{admin && <AdminNav />}");
  });

  it("filters the Developers and Testers lists by side and searches name and email", async () => {
    const admin = await makeUser();
    await db.user.update({ where: { id: admin.user.id }, data: { isAdmin: true } });
    const dev = await makeUser({ dev: true, name: "Developer Needle", email: "dev-needle@playtest.test" });
    const tester = await makeUser({ tester: true, name: "Tester Needle", email: "tester-needle@playtest.test" });
    const both = await makeUser({ dev: true, tester: true, name: "Both Needle" });
    for (const [side, expected, excluded] of [["developer", dev.user.id, tester.user.id], ["tester", tester.user.id, dev.user.id]]) {
      const filtered = await json(await moreGET(req(`/api/admin/more?kind=users&side=${side}&q=Needle`, { cookie: admin.cookie })));
      expect(filtered.status).toBe(200);
      expect(filtered.body.rows.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([expected, both.user.id]));
      expect(filtered.body.rows.map((r: { id: string }) => r.id)).not.toContain(excluded);
      expect(filtered.body.total).toBe(2);
    }
    const devByName = await json(await moreGET(req("/api/admin/more?kind=users&side=developer&q=Developer%20Needle", { cookie: admin.cookie })));
    const devByEmail = await json(await moreGET(req("/api/admin/more?kind=users&side=developer&q=dev-needle%40playtest.test", { cookie: admin.cookie })));
    const testerByName = await json(await moreGET(req("/api/admin/more?kind=users&side=tester&q=Tester%20Needle", { cookie: admin.cookie })));
    expect(devByName.body.rows.map((r: { id: string }) => r.id)).toContain(dev.user.id);
    expect(devByEmail.body.rows.map((r: { id: string }) => r.id)).toContain(dev.user.id);
    expect(devByName.body.rows.map((r: { id: string }) => r.id)).not.toContain(tester.user.id);
    const testerByEmail = await json(await moreGET(req("/api/admin/more?kind=users&side=tester&q=tester-needle%40playtest.test", { cookie: admin.cookie })));
    expect(testerByEmail.body.rows.map((r: { id: string }) => r.id)).toEqual([tester.user.id]);
    expect(testerByName.body.rows.map((r: { id: string }) => r.id)).toContain(tester.user.id);
    expect(testerByName.body.rows.map((r: { id: string }) => r.id)).not.toContain(dev.user.id);
  });

  it("refuses non-admins on both pages and their list endpoint", async () => {
    const user = await makeUser({ dev: true });
    vi.mocked(requirePageUser).mockResolvedValue(user.user);
    for (const page of [(await import("@/app/admin/developers/page")).default, (await import("@/app/admin/testers/page")).default]) {
      await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    const response = await json(await moreGET(req("/api/admin/more?kind=users&side=developer", { cookie: user.cookie })));
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("not_admin");
  });
});
