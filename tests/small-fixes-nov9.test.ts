import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pressLabelOf, pressVerb, SEND_ANSWERS } from "@/lib/pressLabels";
import { workOverPress } from "@/lib/rules";
import { NDA_ONLY_EDIT } from "@/lib/ndaEditing";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 9, item 4) Small fixes: refusals name the written answers' button by its real label ("Send Answers") everywhere; the NDA-only line covers a
// closed test; the notice headings name "Cancel the remaining calls" and "Send to the team"; a final refusal clears an older "Press … again" box.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("refusal names: Send Answers everywhere", () => {
  it("the work-over, part-ended and paused refusals name the written answers' Send Answers (as a suspended tester's does)", async () => {
    expect(workOverPress("written")).toBe(SEND_ANSWERS);
    const s = await setup();
    const j = await joined(s.testId);
    const at = new Date(Date.now() - 60_000);
    await db.contract.update({ where: { id: j.sessionId }, data: { status: "ended", endKind: "closed", endedAt: at, dueAt: at } });
    await db.test.update({ where: { id: s.testId }, data: { status: "closed", workEndedAt: at, openUntil: at } });
    const r = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], seenAt: seen() });
    expect(r.body.error?.message).toBe("This test ended, so your Send Answers didn't go through.");
  });
});

describe("notice headings name the real buttons", () => {
  it("Cancel the remaining calls; Send to the team", () => {
    expect(pressLabelOf("/api/tests/t/cancel-set")).toBe("Cancel the remaining calls");
    expect(pressLabelOf("/api/sessions/s/cancel-set")).toBe("Cancel the remaining calls");
    expect(workOverPress("cancel-set")).toBe("Cancel the remaining calls");
    expect(pressLabelOf("/api/tests/t/no-show")).toBe("Send to the team");
    expect(pressLabelOf("/api/sessions/s/no-show")).toBe("Send to the team");
    expect(`Press ${pressVerb(pressLabelOf("/api/sessions/s/no-show"))} again to go ahead.`).toBe("Press Send to the team again to go ahead.");
  });

  it("a final refusal clears an older stop box, so only the refusal shows", () => {
    for (const f of ["components/ConfirmAll.tsx", "components/OwedBox.tsx", "app/app/account/SideButton.tsx", "app/app/notifications/AlertSettings.tsx", "app/app/profile/PasswordForm.tsx", "app/app/profile/ProfileForm.tsx"]) {
      const s = src(f);
      expect(s, f).not.toMatch(/\} else set(Err|Msg)\(/);
      expect(s, f).toContain("a refusal replaces an older stop box: only the refusal shows");
    }
    // usePress and useStopOnce's callers already cleared the box on a refusal.
    expect(src("lib/usePress.ts")).toMatch(/\} else \{\n\s+setChanges\(null\);\n\s+setError\(errOf\(e\)\);/);
  });
});

describe("the NDA-only line on a closed test", () => {
  it("covers paused, stopped and closed", () => {
    expect(NDA_ONLY_EDIT).toBe("Only the NDA can be edited while this test is paused, stopped or closed.");
  });
});
