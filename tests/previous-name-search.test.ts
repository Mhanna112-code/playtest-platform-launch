import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveProfile } from "@/lib/server/users";
import { previousNamesFor } from "@/lib/server/previousNames";
import { findTests } from "@/lib/server/tests";
import { invitePanel } from "@/lib/server/invites";
import { hideUnmatched } from "@/app/app/tests/[id]/TesterSearch";
import { joined, setup } from "./fixtures";
import { makeUser, uniq } from "./helpers";

const rename = (id: string, name: string, tester: boolean) => saveProfile(id, { name, pronoun: "they", isDeveloper: !tester, isTester: tester, side: tester ? "tester" : "developer", devices: ["Windows PC"], languages: ["English"], categories: [], confirmed: true });

describe("previous names are searchable only by existing counterparts", () => {
  it("Invite testers finds the old name with the current name, but a new developer cannot search that history", async () => {
    const tag = uniq();
    const w = await setup();
    const j = await joined(w.testId, `Old ${tag}`, "they");
    await rename(j.tester.user.id, `New ${tag}`, true);
    const panel = await invitePanel(w.dev.user.id, w.testId, { q: `Old ${tag}` });
    expect(panel.found.find((r) => r.id === j.tester.user.id)).toMatchObject({ name: `New ${tag}`, previousName: `Old ${tag}` });
    const other = await setup({ title: `Other ${tag}` });
    expect((await invitePanel(other.dev.user.id, other.testId, { q: `Old ${tag}` })).found.some((r) => r.id === j.tester.user.id)).toBe(false);
    await db.block.create({ data: { blockerId: j.tester.user.id, blockedId: w.dev.user.id } });
    expect((await previousNamesFor(w.dev.user.id)).has(j.tester.user.id)).toBe(false);
  });

  it("Find tests matches a previous developer name only for their former tester, and keeps all renames", async () => {
    const tag = uniq();
    const w = await setup();
    await rename(w.dev.user.id, `Before ${tag}`, false);
    const j = await joined(w.testId, "History Tester", "they");
    await rename(w.dev.user.id, `After ${tag}`, false);
    await rename(w.dev.user.id, `Now ${tag}`, false);
    const found = await findTests(j.tester.user, `Before ${tag}`);
    expect(found.find((t) => t.id === w.testId)).toMatchObject({ previousName: `Before ${tag}`, developer: { name: `Now ${tag}` } });
    expect((await previousNamesFor(j.tester.user.id)).get(w.dev.user.id)).toContain(`After ${tag}`);
    const outsider = await makeUser({ tester: true });
    expect((await findTests(outsider.user, `Before ${tag}`)).some((t) => t.id === w.testId)).toBe(false);
  });

  it("the roster filter retains the current name and labels only the matched previous name", () => {
    const note = { textContent: "", hidden: true };
    const row = { dataset: { testerName: "Current Name", previousNames: JSON.stringify(["Earlier Name"]) }, hidden: false, querySelector: () => note };
    const root = { querySelectorAll: () => [row] } as unknown as HTMLElement;
    expect(hideUnmatched(root, "[data-tester-name]", "testerName", "Earlier")).toBe(1);
    expect(note).toMatchObject({ textContent: " · previously Earlier Name", hidden: false });
    expect(row.dataset.testerName).toBe("Current Name");
    hideUnmatched(root, "[data-tester-name]", "testerName", "Current");
    expect(note.hidden).toBe(true);
    expect(hideUnmatched(root, "[data-tester-name]", "testerName", "Unknown")).toBe(0);
  });
});
