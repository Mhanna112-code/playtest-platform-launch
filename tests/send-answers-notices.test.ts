import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const form = readFileSync("src/app/app/sessions/[id]/SessionActions.tsx", "utf8")
  .split("export function WrittenForm")[1]
  .split("</form>")[0];

it("keeps field mistakes above the answers and stacks Send Answers notices below the button", () => {
  expect(form).toMatch(/<FormMistakes top text=\{msg && !msg.ok && msg.text.startsWith\(FIELD\)/);
  // (Owner, Nov 11, §380 D2) The refusal is kept apart from the red notes (`refused`), so both show after one press.
  expect(form).toMatch(/SEND_ANSWERS\}<\/button>[\s\S]*?<Err text=\{refused \|\| \(msg && !msg.ok && !msg.text.startsWith\(FIELD\)[\s\S]*?<PausedSend[\s\S]*?<ChangesBox/);
});

it("clears earlier retry and pause notices as soon as Send Answers succeeds", () => {
  const success = form.split("await api(`/api/sessions/${sessionId}/written`")[1].split("} catch (err)")[0];
  expect(success).toContain("setBox(null);");
  expect(success).toContain('setBoxAt("");');
  expect(success).toContain("setPausedNow(false);"); // (Owner, Nov 11, §376) a mark, never the refusal's text
  expect(success).toContain('now.finish("Sent your answers.");'); // (§371) in the form shown now
});
