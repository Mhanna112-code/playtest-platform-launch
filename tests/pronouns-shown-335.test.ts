import React, { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { pronounLabel } from "@/lib/format";
import { PronounTag } from "@/components/PronounTag";
import { PersonHover } from "@/components/PersonHover";
import { Seats } from "@/components/Ui";
import { personHoverFor } from "@/lib/server/personHover";
import { makeUser } from "./helpers";

// (Owner, Nov 9, §335) Pronouns on profiles and hover cards, where one is set; unset shows nothing.
const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, adminAway: () => {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/testers/x", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

/** The profile page's <h1> (the page holds async parts that can't render here). */
function h1Of(node: ReactNode): React.ReactElement | null {
  if (Array.isArray(node)) { for (const n of node) { const f = h1Of(n); if (f) return f; } return null; }
  if (!isValidElement(node)) return null;
  if (node.type === "h1") return node;
  return h1Of((node.props as { children?: ReactNode }).children);
}

describe("§335 pronouns where they're set", () => {
  it("the label is the profile's own wording; unset (or unknown) is nothing", () => {
    expect(pronounLabel("she")).toBe("she / her");
    expect(pronounLabel("he")).toBe("he / him");
    expect(pronounLabel("they")).toBe("they / them");
    expect(pronounLabel("")).toBe("");
    expect(pronounLabel(null)).toBe("");
    expect(renderToStaticMarkup(createElement(PronounTag, { pronoun: "" }))).toBe("");
  });

  it("the name hover cards: PersonHover and the dashboard's tester circles", () => {
    const card = renderToStaticMarkup(createElement(PersonHover, { name: "Nina Park", href: "/app/testers/n", summary: ["No ratings yet"], pronoun: "she" }));
    expect(card).toMatch(/data-card-name="">[\s\S]*Nina Park[\s\S]*<\/span><span class="[^"]*" data-pronoun="">she \/ her<\/span>/);
    expect(renderToStaticMarkup(createElement(PersonHover, { name: "Nina Park", href: "/app/testers/n", summary: [] }))).not.toContain("data-pronoun");
    const seats = renderToStaticMarkup(createElement(Seats, { total: 2, people: [{ id: "a", name: "Ana", pronoun: "he" }, { id: "b", name: "Ben", pronoun: "" }] }));
    expect(seats.match(/data-pronoun="">he \/ him/g)).toHaveLength(1);
    expect(seats.match(/data-pronoun=/g)).toHaveLength(1);
  });

  it("personHoverFor carries the pronoun (Messages and chat cards)", async () => {
    const viewer = await makeUser({ dev: true, name: "Nora Lane" });
    const tester = await makeUser({ tester: true, name: "Alex Morgan", pronoun: "they" });
    expect((await personHoverFor(viewer.user.id, "developer", tester.user))?.pronoun).toBe("they");
  });

  it("the tester and developer profiles show it after the name, and nothing when unset", async () => {
    const viewer = await makeUser({ dev: true, tester: true, name: "Nora Lane" });
    const she = await makeUser({ dev: true, tester: true, name: "Dee Moss", pronoun: "she" });
    const unset = await makeUser({ dev: true, tester: true, name: "Sam Reed", pronoun: "" });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: viewer.user.id } });
    const { default: TesterPage } = await import("@/app/app/testers/[id]/page");
    const { default: DeveloperPage } = await import("@/app/app/developers/[id]/page");
    for (const Page of [TesterPage, DeveloperPage]) {
      const shown = renderToStaticMarkup(h1Of(await Page({ params: Promise.resolve({ id: she.user.id }) }))!);
      expect(shown).toContain('Dee Moss <span class="font-normal text-slate-400 text-base" data-pronoun="">she / her</span>');
      const none = renderToStaticMarkup(h1Of(await Page({ params: Promise.resolve({ id: unset.user.id }) }))!);
      expect(none).toContain("Sam Reed");
      expect(none).not.toContain("data-pronoun");
    }
  });
});
