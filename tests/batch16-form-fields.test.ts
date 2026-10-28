import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as R from "@/lib/rules";
import { overLimitText } from "@/lib/capacity";
import { keyNeedLine, keyRefusal } from "@/lib/keys";
import { CRITICAL_KEYS, criticalLine } from "@/lib/limits";
import { LISTING_MISTAKES, fieldOfMistake } from "@/lib/listingFields";

// Batch 16 sections 8, 9 and 10 on Post / Edit: no NDA preview; Mature's two lines; every server field mistake lands on its field.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const DAY = 86_400_000;
const listing = (over: Partial<R.Listing> = {}): R.Listing => ({
  productName: "Harbor Run", mature: false, matureWhy: "", ndaText: "", title: "Harbor Run", description: "A boat game", buildUrl: "https://example.com/build", categories: ["Game"],
  devices: [], languages: [], spots: 5, writtenCents: 1000, recordingCents: 1500, liveRateCents: 3000, liveMinutes: 30, deadlineDays: 7,
  questions: ["What did you like?"], openUntil: new Date(Date.now() + 12 * DAY).toISOString(), joinMode: "anyone", ...over,
});

/** Every message checkListing can give, one listing per mistake. */
function allListingMessages() {
  const now = new Date();
  const cases: [Partial<R.Listing>, number, R.ListingCtx?][] = [
    [{ joinMode: "nobody" }, 0],
    [{ openUntil: null }, 0],
    [{ openUntil: "not a date" }, 0],
    [{ openUntil: new Date(Date.now() - DAY).toISOString() }, 0],
    [{ openUntil: new Date(Date.now() + 40 * DAY).toISOString() }, 0],
    [{ openUntil: new Date(Date.now() + DAY).toISOString() }, 0],
    [{ productName: "" }, 0],
    [{ productName: "x".repeat(500) }, 0],
    [{ title: "" }, 0],
    [{ title: "x".repeat(500) }, 0],
    [{ description: "" }, 0],
    [{ description: "x".repeat(50_000) }, 0],
    [{ mature: true, matureWhy: "" }, 0],
    [{ mature: true, matureWhy: "idk" }, 0],
    [{ ndaText: "x".repeat(50_000) }, 0],
    [{ categories: [] }, 0],
    [{ spots: 0 }, 0],
    [{ spots: 2 }, 3],
    [{ writtenCents: null, recordingCents: null, liveRateCents: null }, 0],
    [{ writtenCents: 50 }, 0],
    [{ writtenCents: 200_000 }, 0],
    [{ writtenCents: 30_000 }, 0],
    [{ recordingCents: 50 }, 0],
    [{ recordingCents: 200_000 }, 0],
    [{ recordingCents: 30_000 }, 0],
    [{ liveRateCents: 500 }, 0],
    [{ liveRateCents: 50_000 }, 0],
    [{ questions: [] }, 0],
    [{ questions: Array(200).fill("Q?") }, 0],
    [{ questions: ["Q".repeat(30_000)] }, 0],
  ];
  const out = new Set<string>();
  for (const [over, testersIn, ctx] of cases) for (const m of R.checkListing(listing(over), testersIn, now, ctx ?? {})) out.add(m);
  return [...out];
}

describe("every Post / Edit field mistake lands on its field (section 10)", () => {
  it("each message from checkListing and the Post / Edit routes maps to a field; no misses", () => {
    const messages = [
      ...allListingMessages(),
      overLimitText(5),
      keyNeedLine(3, 1),
      keyRefusal("HR-1111", "free"),
      keyRefusal("HR-1111", "inuse", { working: true, name: "Ana Silva" }),
      R.openUntilShortened(new Date(Date.now() + 10 * DAY).toISOString(), new Date(Date.now() + 5 * DAY).toISOString(), (d) => d.toISOString().slice(0, 10)),
    ].filter(Boolean);
    expect(messages.length).toBeGreaterThan(30);
    const misses = messages.filter((m) => fieldOfMistake(m) == null);
    expect(misses).toEqual([]);
    // A few that need the right field, not just any.
    expect(fieldOfMistake(R.MATURE_WHY_REQUIRED)).toBe("matureWhy");
    expect(fieldOfMistake(R.MATURE_WHY_SHORT)).toBe("matureWhy");
    expect(fieldOfMistake(keyNeedLine(3, 1))).toBe("keys");
    expect(fieldOfMistake(overLimitText(5))).toBe("spots");
    expect(fieldOfMistake("Choose at least one kind of feedback.")).toBe("parts");
    expect(fieldOfMistake("Add at least one question for the written answers.")).toBe("questions");
    expect(fieldOfMistake(R.partLowLine("written answers"))).toBe("writtenPrice");
    expect(fieldOfMistake(`Tick “${R.HIGH_PART_TICK}” for the recording price.`)).toBe("highRecording");
    expect(fieldOfMistake(R.OPEN_UNTIL_RANGE)).toBe("openUntil");
    // A changed-field-limit line stays under the button.
    for (const k of CRITICAL_KEYS) expect(fieldOfMistake(criticalLine(k))).toBeNull();
  });

  it("every field the mapping names has its box in the form", () => {
    const form = src("app/app/tests/TestForm.tsx");
    const keys = src("app/app/tests/KeyBoxes.tsx");
    const has: Record<string, boolean> = {
      joinMode: form.includes('id="joinMode"'), openUntil: form.includes('text("openUntil"'), productName: form.includes('text("productName"'), title: form.includes('text("title"'),
      description: form.includes('id="description"'), matureWhy: form.includes('id="matureWhy"'), ndaText: form.includes('id="ndaText"'), categories: form.includes('<fieldset id="categories" data-field-group=""'),
      parts: form.includes('<fieldset id="parts" data-field-group=""'), spots: form.includes('text("spots"'), highWritten: form.includes("id={`high-${part.key}`}"), highRecording: form.includes("id={`high-${part.key}`}"),
      writtenPrice: form.includes('price: "writtenPrice"') && form.includes("id={part.price}"), recordingPrice: form.includes('price: "recordingPrice"'), liveRate: form.includes('price: "liveRate"'),
      questions: form.includes('id="questions"'), keys: form.includes('id="accessKeys"') && keys.includes('id="keysFree"'),
    };
    for (const [k] of LISTING_MISTAKES) expect(has[k], k).toBe(true);
  });

  it("the client checks use the server's own lines, and the list reads the red fields", () => {
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("data-required-msg={DESCRIPTION_REQUIRED}");
    expect(form).toContain("data-min-msg={part.lowMsg} data-max-msg={part.highMsg}");
    expect(form).toContain('lowMsg: partLowLine("written answers"), highMsg: partHighLine("written answers")');
    expect(form).toContain("lowMsg: rateLowLine(), highMsg: rateHighLine()");
    expect(form).toContain('"data-required-msg": OPEN_UNTIL_RANGE');
    expect(form).toContain('<MistakeList press={edit ? "Save" : "Post the test"} orphans={orphans} />');
    expect(form).toContain("markServerMistakes(formRef.current, messages,");
    expect(form).toContain("focusFirstMistake(formRef.current)");
    expect(form).not.toContain("FIELD_WORDS");
    expect(form).not.toMatch(/errs\.map\(/);
    const fc = src("components/FieldChecks.tsx");
    expect(fc).toContain("export function MistakeList");
    expect(fc).toContain("export function markServerMistakes");
    // Re-checked as it's typed once red; another field's typing never clears it (each box keeps its own mark).
    expect(fc).toContain("if (notes.has(el) || server.has(el)) showField(el);");
    expect(fc).toContain('data-mistake-link=""');
  });
});

describe("Mature (18+): say why the box is red (section 9)", () => {
  it("empty and too short give their own lines, the same at the field and from the server; 5 characters pass", () => {
    const now = new Date();
    expect(R.checkListing(listing({ mature: true, matureWhy: "" }), 0, now)).toContain(R.MATURE_WHY_REQUIRED);
    expect(R.checkListing(listing({ mature: true, matureWhy: "  idk " }), 0, now)).toContain(R.MATURE_WHY_SHORT);
    expect(R.MATURE_WHY_SHORT).toBe("Say a little more: at least 5 characters.");
    expect(R.MATURE_WHY_REQUIRED).toBe("Say why this test is mature (18+): it's required for mature content.");
    expect(R.checkListing(listing({ mature: true, matureWhy: "Gore!" }), 0, now).some((m) => fieldOfMistake(m) === "matureWhy")).toBe(false);
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("data-required-msg={MATURE_WHY_REQUIRED} data-min-chars={String(MATURE_WHY_MIN)} data-msg={MATURE_WHY_SHORT}");
    expect(form).toContain('data-mature-count="">{f.matureWhy.length.toLocaleString("en-US")} / {LIMITS.matureWhy.toLocaleString("en-US")}');
    expect(form).toContain("Tick this if your test has mature content, and say why. Never allowed: sexual content involving minors, illegal content, real-world gore. Other graphic content must be marked Mature.");
    expect(form).not.toContain("No graphic content");
  });
});

describe("no NDA preview on Post / Edit (section 8)", () => {
  it("TestForm has no NdaBox; the join page, session page and terms history keep it", () => {
    expect(src("app/app/tests/TestForm.tsx")).not.toMatch(/NdaBox|How testers see it/);
    for (const f of ["app/app/find/[id]/JoinBox.tsx", "app/app/sessions/[id]/page.tsx", "app/app/sessions/[id]/TesterTop.tsx"]) expect(src(f)).toContain("<NdaBox");
  });
});
