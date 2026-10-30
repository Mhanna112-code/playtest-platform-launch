import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as switchPOST } from "@/app/app/switch/route";
import { makeUser } from "./helpers";

// Batch 34 §17 (owner, Oct 30): the header's side switch is a direct POST to /app/switch (a form), not a link through the GET in-between page
// "Switch to your … side and continue" that flashed or hung.

(globalThis as unknown as { React: typeof React }).React = React;
const who = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => who.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-path": "/app" }), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), redirect: () => { throw new Error("redirect"); } }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

describe("batch 34 §17: the header's side switch is a direct POST", () => {
  it("the header renders a POST form to /app/switch (to = the other side, next = /app) with the same-looking button; no /app/switch link", async () => {
    const both = await makeUser({ dev: true, tester: true, name: "Nora Lane" });
    who.user = await db.user.update({ where: { id: both.user.id }, data: { side: "developer" } });
    const { default: AppLayout } = await import("@/app/app/layout");
    const html = renderToStaticMarkup(await AppLayout({ children: React.createElement("p", null, "page") }));
    const form = html.match(/<form[^>]*data-side-switch=""[^>]*>[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).toMatch(/method="post"/);
    expect(form).toMatch(/action="\/app\/switch"/);
    expect(form).toContain('<input type="hidden" name="to" value="tester"/>');
    expect(form).toContain('<input type="hidden" name="next" value="/app"/>');
    expect(form).toMatch(/<button type="submit" class="nav-link border border-white\/10" title="Go to your tester side" aria-label="Switch to tester">/);
    expect(form).toContain('<span class="hidden 2xl:inline">Tester</span>');
    expect(html).not.toMatch(/href="\/app\/switch/);
    // The form's POST (same origin) switches and goes straight to the dashboard.
    const r = await switchPOST(new Request("http://localhost:3400/app/switch", { method: "POST", headers: { cookie: both.cookie, origin: "http://localhost:3400", "content-type": "application/x-www-form-urlencoded" }, body: "to=tester&next=/app" }));
    expect(r.status).toBe(303);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/app");
    expect((await db.user.findUniqueOrThrow({ where: { id: both.user.id } })).side).toBe("tester");
  });
});
