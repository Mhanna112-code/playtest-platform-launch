import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PART_PANEL } from "@/lib/panelStyle";

// (Owner, Nov 9, §351) The developer test page's part panels rendered a class attribute holding a function's source ("function() { throw new Error("Attempted to
// call PART_PANEL() from the server…") }"): a constant imported from a "use client" module (components/Panel) into server components. It lives in a plain module now.
const SRC = path.join(process.cwd(), "src");
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

describe("§351 server modules never take plain constants from a client module", () => {
  it("PART_PANEL is a class string", () => {
    expect(PART_PANEL).toBe("min-w-0 rounded-lg border border-white/10 p-2");
  });
  it("no server module imports anything but components (capitalised) from components/Panel", () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      const s = fs.readFileSync(f, "utf8");
      if (/^\s*["']use client["']/.test(s)) continue;
      for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/components\/Panel["']/g))
        for (const name of m[1].split(",").map((x) => x.trim().replace(/^type\s+/, "")).filter(Boolean)) if (!/^[A-Z][a-z]/.test(name)) bad.push(`${path.relative(SRC, f)}: ${name}`);
    }
    expect(bad).toEqual([]);
  });
});
