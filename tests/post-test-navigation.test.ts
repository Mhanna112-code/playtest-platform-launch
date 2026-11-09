import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps Post disabled after a new test or draft posts until navigation", () => {
  const form = readFileSync("src/app/app/tests/TestForm.tsx", "utf8");
  const submit = form.split("async function submit")[1].split("// (Owner, Oct 29, batch 30 §18)")[0];
  const post = submit.split("if (!edit) {")[1].split("const all = toApi(f);")[0];
  expect(post).toMatch(/await api.*post-draft.*\r?\n\s+await keep\.clear\(\);\s+leaving\.current = true;\s+window\.location\.href/);
  expect(submit).toContain("if (!leaving.current) setBusy(false);");
  expect(form).toContain("disabled={busy || nothingChanged}");
});
