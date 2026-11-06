import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filteredOutLine } from "@/lib/inviteText";

describe("(Owner, Nov 5) §273 a search that finds nobody only because of the ticks says so", () => {
  it("names the ticks and how many match without them", () => {
    expect(filteredOutLine("mha", ["Korean"], 1)).toBe("No testers match “mha” with Korean ticked: 1 tester matches without the filters.");
    expect(filteredOutLine("ana", ["Mac", "Korean"], 3)).toBe("No testers match “ana” with Mac, Korean ticked: 3 testers match without the filters.");
  });
  it("the server counts the name matches the filters left out (only when nothing matched and something is ticked); the panel shows the line, else the plain one", () => {
    const s = fs.readFileSync(path.resolve(__dirname, "../src/lib/server/invites.ts"), "utf8");
    expect(s).toContain("const filteredOut = q.length >= 1 && !matches.length && (devices.length || languages.length) ? lean.filter((x) => nameMatches(x.name, q)).length : 0;");
    const p = fs.readFileSync(path.resolve(__dirname, "../src/app/app/tests/[id]/InvitePanel.tsx"), "utf8");
    expect(p).toContain('data-invite-none="filters">{filteredOutLine(term, [...f.devices, ...f.languages], data.filteredOut)}');
    expect(p).toContain("No testers match “{term}”.");
  });
});
