import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const form = readFileSync("src/app/app/sessions/[id]/SessionActions.tsx", "utf8")
  .split("export function WrittenForm")[1]
  .split("</form>")[0];

it("keeps field mistakes above the answers and stacks Send Answers notices below the button", () => {
  expect(form).toMatch(/<FormMistakes top text=\{msg && !msg.ok && msg.text.startsWith\(FIELD\)/);
  expect(form).toMatch(/SEND_ANSWERS\}<\/button>[\s\S]*?<Err text=\{msg && !msg.ok && !msg.text.startsWith\(FIELD\)[\s\S]*?<PausedSend[\s\S]*?<ChangesBox/);
});

it("clears earlier retry and pause notices as soon as Send Answers succeeds", () => {
  const success = form.split("await api(`/api/sessions/${sessionId}/written`")[1].split("} catch (err)")[0];
  expect(success).toContain("setBox(null);");
  expect(success).toContain('setBoxAt("");');
  expect(success).toContain('setPausedNow("");');
  expect(success).toContain('fin.finish("Sent your answers.");');
});
