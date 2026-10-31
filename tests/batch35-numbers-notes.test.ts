import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MONEY_TEXT, digitsOnly, keyAllowed, moneyText, pastedNumber, typedMoney, wholeText } from "@/lib/numberInput";
import { CHANGED_IN_TAB, mergeElsewhere, wasLine } from "@/lib/editMerge";
import { WasNote } from "@/components/FieldNote";
import { BUILD_URL_LINE, BUILD_URL_PATTERN, buildUrlOk, fieldOfMistake } from "@/lib/listingFields";
import { parseListing } from "@/lib/server/tests";
import { db } from "@/lib/db";
import { GET as liveGET } from "@/app/api/live/route";
import { joinerDays, openUntilExtendLine, openUntilShortened, type Listing } from "@/lib/rules";
import { mistakeBullets, needsFixingLine } from "@/components/FieldChecks";
import { panelKeysOf, panelRows } from "@/lib/listingPanel";
import { SAVED_ELSEWHERE_LINE, editedLine } from "@/lib/listingSave";
import { consequenceLine } from "@/lib/server/live";
import { mergeChanges } from "@/lib/live";
import { json, req } from "./helpers";
import { act, joined, seen, setup } from "./fixtures";

(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []));

// Batch 35 §25-§28 (owner, Oct 31).

describe("batch 35 §25: number-only boxes", () => {
  it("a money box keeps digits and the first decimal point, at most 2 decimals; a paste keeps only those", () => {
    expect(moneyText("$1,000.50")).toBe("1000.50");
    expect(moneyText("-5.00")).toBe("5.00");
    expect(moneyText("1.2.3")).toBe("1.23");
    expect(moneyText("12.345")).toBe("12.34");
    expect(moneyText("abc")).toBe("");
    expect(moneyText("0")).toBe("0");
    expect(moneyText("7.")).toBe("7.");
    expect(moneyText(" 9 . 9 9 ")).toBe("9.99");
    for (const ok of ["", "0", "12", "12.", "12.3", "12.34", ".5"]) expect(MONEY_TEXT.test(ok), ok).toBe(true);
    for (const bad of ["12.345", "1.2.3", "a", "-1", "1,000", "$5"]) expect(MONEY_TEXT.test(bad), bad).toBe(false);
  });

  it("typing anything else into a money box is ignored: the box keeps what it had", () => {
    expect(typedMoney("12.3", "12.")).toBe("12.3");
    expect(typedMoney("12.345", "12.34")).toBe("12.34"); // a third decimal
    expect(typedMoney("1.2.5", "1.25")).toBe("1.25"); // a second point
    expect(typedMoney("1a", "1")).toBe("1"); // a letter
    expect(typedMoney("$5", "5")).toBe("5");
    expect(typedMoney("1,5", undefined)).toBe("15"); // nothing to go back to: cleaned
    expect(keyAllowed("money", "5")).toBe(true);
    expect(keyAllowed("money", ".", "12")).toBe(true);
    expect(keyAllowed("money", ".", "12.5")).toBe(false);
    expect(keyAllowed("money", ".", "125")).toBe(true); // the point was inside the selection being typed over
    for (const k of ["-", "e", "+", ",", "$", "a", " "]) expect(keyAllowed("money", k), k).toBe(false);
    expect(keyAllowed("whole", "7")).toBe(true);
    for (const k of [".", "-", "e", "+", ","]) expect(keyAllowed("whole", k), k).toBe(false);
  });

  it("a paste goes over the selection, cleaned; a whole-number box keeps only digits (never only zeros)", () => {
    expect(pastedNumber("money", "", "$1,000.50", 0, 0)).toBe("1000.50");
    expect(pastedNumber("money", "25.00", "$1,000.50", 0, 5)).toBe("1000.50"); // over the whole value
    expect(pastedNumber("money", "5", "0.25", 1, 1)).toBe("50.25");
    expect(pastedNumber("money", "1.5", "2.25", 3, 3)).toBe("1.52");
    expect(pastedNumber("money", "8", "$9.999", null, null)).toBe("9.99"); // no selection known: the paste replaces it
    expect(pastedNumber("whole", "", "1,000", 0, 0)).toBe("1000");
    expect(pastedNumber("whole", "4", " 12 testers", null, null)).toBe("12");
    expect(pastedNumber("whole", "4", "0", null, null, "4")).toBe("4");
    expect(pastedNumber("whole", "1", "2.5", 1, 1)).toBe("125");
    expect(digitsOnly("a1-2e3")).toBe("123");
    // Batch 20 section 19 still holds.
    expect(wholeText("-20")).toBe("20");
    expect(wholeText("0", "3")).toBe("3");
    expect(wholeText("007")).toBe("7");
  });

  it("one shared helper: FieldChecks applies it to every data-money / data-whole box; every money and count box carries one", () => {
    const fc = src("components/FieldChecks.tsx");
    expect(fc).toContain('import { digitsOnly, keyAllowed, moneyText, pastedNumber, typedMoney, wholeText } from "@/lib/numberInput";');
    expect(fc).toContain('export { moneyText, wholeText } from "@/lib/numberInput";');
    expect(fc).not.toMatch(/export (function|const) (wholeText|moneyText)/);
    expect(fc).toContain('document.addEventListener("beforeinput", onBefore, true);');
    expect(fc).toContain('document.addEventListener("keydown", onKey, true);');
    expect(fc).toContain('document.addEventListener("paste", onPaste, true);');
    expect(fc).toContain("if (!keyAllowed(kind, e.key, outside)) e.preventDefault();");
    expect(fc).toContain("const next = pasted ? moneyText(el.value) : typedMoney(el.value, was?.value);");
    // Every box with a number keyboard is a money or whole-number box (and nothing else cleans digits by itself).
    const files = walk(path.resolve(__dirname, "../src"));
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      for (const line of text.split("\n").filter((l) => /inputMode[=:]\s*"decimal"/.test(l))) expect(line, f).toContain('data-money=""');
      for (const line of text.split("\n").filter((l) => /inputMode[=:]\s*"numeric"/.test(l))) expect(line, f).toMatch(/"data-whole": ""|data-whole=""/);
      if (!f.endsWith("numberInput.ts")) expect(text, f).not.toMatch(/\.replace\(\/\\D\/g/);
    }
    // The money boxes the owner named, and the count boxes.
    expect(src("app/app/tests/TestForm.tsx")).toMatch(/id=\{part\.price\}[^\n]*inputMode="decimal" data-money=""/); // written / recording prices, the live call rate
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain('id={`rate-${p.id}`} className="input w-24" inputMode="decimal" data-money=""'); // a call's rate in Pay
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain('id={`amt-${p.id}`} className="input w-32" inputMode="decimal" data-money=""'); // Pay / Pay more amounts
    expect(src("app/admin/DisputeDecision.tsx")).toMatch(/id=\{`total-\$\{id\}`\}[^\n]*data-money=""/);
    expect(src("app/app/sessions/[id]/ChoiceBox.tsx")).toMatch(/inputMode="decimal" data-money="" aria-label="Amount to charge"/);
    expect(src("app/app/tests/TestForm.tsx")).toContain('inputMode: "numeric", "data-max": String(limit), "data-whole": ""'); // spots
    for (const p of ["components/CallRequests.tsx", "app/app/tests/[id]/DevCallPanel.tsx"]) expect(src(p)).toMatch(/aria-label="Length in minutes"[^\n]*data-whole=""/);
    expect(src("app/admin/AdminButton.tsx")).toContain('{...(f.name === "days" ? { inputMode: "numeric" as const, "data-whole": "" } : {})}'); // Extend's days
    // The range checks and the rounding on leaving stay.
    expect(fc).toContain("if (e.target instanceof HTMLInputElement && e.target.dataset.money != null) roundMoneyBox(e.target);");
    expect(fc).toContain('if (n > max) return el.dataset.maxMsg ?? msg ?? `From ${min} to ${max}.`;');
  });
});

describe("batch 35 §26: notes under untouched Edit fields", () => {
  it("the line: “Changed in another tab at 11:43 PM: was “…”” (no Use theirs)", () => {
    expect(CHANGED_IN_TAB).toBe("Changed in another tab at");
    expect(wasLine("11:43 PM", "Harbor Run")).toBe("Changed in another tab at 11:43 PM: was “Harbor Run”");
    expect(wasLine("11:43 PM", null)).toBe("Changed in another tab at 11:43 PM: was empty");
    expect(wasLine("11:43 PM", "$15.00", "Price for a recording")).toBe("Changed in another tab at 11:43 PM: Price for a recording was “$15.00”");
    const html = renderToStaticMarkup(createElement(WasNote, { items: [{ field: "title", time: "11:43 PM", was: "Harbor Run" }] }));
    expect(html).toContain("Changed in another tab at 11:43 PM: was “Harbor Run”");
    expect(html).toContain('class="info mt-1.5 space-y-1 !p-2 text-xs"'); // the existing blue note style
    expect(html).toContain("data-field-note");
    expect(html).not.toContain("Use theirs");
    const long = renderToStaticMarkup(createElement(WasNote, { items: [{ field: "description", time: "9:05 AM", was: "Step one\nStep two\nStep three\nStep four" }] }));
    expect(long).toContain("Changed in another tab at 9:05 AM: was</p>");
    expect(long).toContain("data-fold-text");
    expect(renderToStaticMarkup(createElement(WasNote, { items: [] }))).toBe("");
  });

  it("which fields get it: untouched ones that took the saved value; never spots / Open until (their own notes) or a typed field (Use theirs)", () => {
    const base = { title: "Harbor Run", buildUrl: "https://a.test", spots: "4", description: "Old steps" };
    const f = { ...base, description: "My steps" }; // typed here
    const now = { title: "Harbor Run: nights", buildUrl: "https://a.test", spots: "5", description: "Their steps" };
    const m = mergeElsewhere(f, base, now);
    const quiet = m.take.filter((k) => !m.oldNote.includes(k));
    expect(quiet).toEqual(["title"]);
    expect(m.oldNote).toEqual(["spots"]);
    expect(m.keep).toEqual(["description"]);
  });

  it("TestForm: set live from applyElsewhere, shown under the field, gone when the field is edited and on Save", () => {
    const t = src("app/app/tests/TestForm.tsx");
    // (Batch 35 §64) Untouched fields change silently again: nothing sets a "was" note.
    expect(t).not.toContain("value: emptyValue(base[k])");
    expect(t).toContain("batch 35 §64) Untouched fields change silently again");
    expect(t).toContain("dropWas(Object.keys(p) as (keyof F)[]); // (batch 35 §26) edited here");
    expect(t).toContain('dropWas("all"); // (batch 35 §26) on Save');
    expect(t).toContain("<WasNote items={quiet.map((x) => ({ field: String(x), name: x === k ? undefined : NAMES[x] ?? String(x), time: clock(was[x]!.at), was: wasText(was[x]!.value) }))} />");
    // Use saved / Start empty / Use saved for all count as editing it; a Save that went through clears it with the other notes.
    expect(t).toMatch(/setTheirs\(\(o\) => Object\.fromEntries\(Object\.entries\(o\)\.filter\(\(\[x\]\) => !ks\.includes\(x as keyof F\)\)\) as typeof o\);\n    dropWas\(ks\);/);
    expect(t).toMatch(/setNotes\(\{\}\);\n    setWas\(\{\}\);/);
  });
});

describe("batch 35 §27: the build link checks itself", () => {
  it("one rule and one line for the box and the server; the server's refusal belongs to the box", () => {
    expect(BUILD_URL_LINE).toBe("The build link must start with https://");
    expect(BUILD_URL_PATTERN).toBe("^https://");
    expect(buildUrlOk("https://store.test/build")).toBe(true);
    expect(buildUrlOk("HTTPS://store.test")).toBe(true);
    expect(buildUrlOk("")).toBe(true);
    for (const bad of ["http://store.test", "store.test", "ftp://x", "www.https://x"]) expect(buildUrlOk(bad), bad).toBe(false);
    expect(() => parseListing({ buildUrl: "http://store.test" }, true)).toThrow(BUILD_URL_LINE);
    expect(parseListing({ buildUrl: "https://store.test" }, true).buildUrl).toBe("https://store.test");
    expect(fieldOfMistake(BUILD_URL_LINE)).toBe("buildUrl");
  });

  it("the box: red on leaving it and live once red (FieldChecks data-pattern), matched to the server's line; on Edit once changed", () => {
    const fc = src("components/FieldChecks.tsx");
    expect(fc).toContain('if (el.dataset.pattern != null && v && !new RegExp(el.dataset.pattern, "i").test(v)) return msg ?? "Check this field.";');
    expect(fc).toContain("el.dataset.pattern != null ||"); // hasRules: checked on leaving and on a press
    expect(fc).toMatch(/RULE_ATTRS = \[[^\]]*"data-pattern"/);
    const t = src("app/app/tests/TestForm.tsx");
    expect(t).toContain('attrs: { "data-match": "^The build link must start", ...(!edit || f.buildUrl !== base.buildUrl ? { "data-pattern": BUILD_URL_PATTERN, "data-msg": BUILD_URL_LINE } : {}) }');
    expect(new RegExp("^The build link must start", "i").test(BUILD_URL_LINE)).toBe(true);
    expect(src("lib/server/tests.ts")).toContain('if (out.buildUrl && !buildUrlOk(out.buildUrl)) throw new HttpError(400, "bad_url", BUILD_URL_LINE);');
  });
});

describe("batch 35 §28: the cents wording", () => {
  it("the parts help line starts “Prices can include cents, like 9.99.”", () => {
    const t = src("app/app/tests/TestForm.tsx");
    expect(t).toContain("Prices can include cents, like 9.99. Free makes a part unpaid. Otherwise $1 to $1,000 for the written answers or a recording");
    expect(t).not.toContain("Any cents.");
  });
});

describe("batch 35 §29: labels apart from values wherever listing or contract fields are listed", () => {
  it("one shared look (FieldLabel / FieldValue): the §15 label and value, as the Listing panel draws them", async () => {
    const { FIELD_LABEL, FieldLabel, FieldValue } = await import("@/components/FieldLines");
    expect(FIELD_LABEL).toBe("text-[11px] font-medium uppercase tracking-wide text-slate-400");
    expect(renderToStaticMarkup(createElement(FieldLabel, { tag: createElement("b", null, "Updated 3:00 PM") }, "Product"))).toBe('<div class="leading-5"><span class="text-[11px] font-medium uppercase tracking-wide text-slate-400" data-panel-label="">Product</span><b>Updated 3:00 PM</b></div>');
    expect(renderToStaticMarkup(createElement(FieldValue, null, "PENIQQQ"))).toBe('<div class="mt-0.5 text-slate-100" data-panel-value="">PENIQQQ</div>');
    const panel = src("app/app/tests/[id]/ListingPanel.tsx");
    expect(panel).toContain('import { FIELD_BOX, FieldLabel, FieldValue } from "@/components/FieldLines";');
    expect(panel).toContain("<FieldLabel tag={tag(l)}>{l.label}</FieldLabel>");
    expect(panel).not.toContain("text-[11px] font-medium uppercase"); // reused, not a copy
  });

  it("the tester's “Your agreed scope”: its contract and its listing information", () => {
    const s = src("app/app/sessions/[id]/page.tsx");
    const scope = s.slice(s.indexOf('<details className="card scroll-mt-24" id="scope"'), s.indexOf("{/* (Design doc 9) The terms history"));
    expect(scope).toContain("<FieldLabel>{x.name}</FieldLabel>");
    expect(scope).toContain("<FieldLabel>Questions</FieldLabel><FieldValue><QuestionList numbered items={writtenQuestions(c).map((q) => ({ text: qText(q), required: qRequired(q) }))} />");
    expect(scope).toContain("<FieldLabel>NDA</FieldLabel>");
    expect(scope).toContain("<FieldLabel>Due</FieldLabel><FieldValue>{fmtDate(c.dueAt)}</FieldValue>");
    expect(scope).toContain('<FieldLabel tag={l.before != null ? <UpdatedTag when={l.updatedAt ? fmtDateTimeIn(l.updatedAt, u.timeZone) : ""} before={l.before} now={l.now} /> : null}>{l.label}</FieldLabel>');
    expect(scope).toContain('<ScrollText text={c.test.description} className={FIELD_BOX} label="What to do" />');
    // No "Label: value" run together any more.
    expect(scope).not.toMatch(/\{l\.label\}:|\{x\.name\}:|>Questions: <|NDA: none|NDA: accepted|<li>Due \{/);
  });

  it("the new-terms offer (Switch / Keep) and the terms history's questions then and now", () => {
    const top = src("app/app/sessions/[id]/TesterTop.tsx");
    expect(top).toContain("<FieldLabel>Before</FieldLabel><FieldValue><QuestionList numbered items={offer.fromQuestions} /></FieldValue>");
    expect(top).toContain("<FieldLabel>After</FieldLabel><FieldValue><QuestionList numbered items={offer.questions} /></FieldValue>");
    expect(top).not.toMatch(/>Before: <QuestionList|>After: <QuestionList/);
    const s = src("app/app/sessions/[id]/page.tsx");
    expect(s).toContain("fromQuestions: ((c.questions as string[]) ?? []).map((q) => ({ text: qText(q), required: qRequired(q) })),");
    expect(s).toContain("<FieldLabel>Offered</FieldLabel><FieldValue><QuestionList numbered");
    expect(s).not.toMatch(/>Then: <QuestionList|>Offered: <QuestionList/);
  });
});

describe("batch 35 §30: Open until's “only extended” line shows once, at the box", () => {
  it("the box and the server say the same words (no year, like the hint beside it)", () => {
    expect(openUntilExtendLine("2026-11-28")).toBe("Open until can only be extended: it's Nov 28 now.");
    expect(openUntilShortened("2026-11-28T23:59:00.000Z", "2026-11-04T23:59:00.000Z")).toBe("Open until can only be extended: it's Nov 28 now.");
    expect(openUntilShortened("2026-11-28T23:59:00.000Z", "2026-11-29T23:59:00.000Z")).toBe("");
    const t = src("app/app/tests/TestForm.tsx");
    expect(t).toContain('const ouLine = shortened ? openUntilExtendLine(base.openUntil.slice(0, 10)) : "";');
    // The page's own line sits right under the box (no second copy under the help line); the server's same text matches the box's data-red-msg, so it isn't added.
    expect(t).toContain('below: showOn("openUntil") ? redLine(ouLine) : null');
    expect(t).not.toContain('{showOn("openUntil") && redLine(ouLine)}');
    expect(src("lib/server/tests.ts")).toContain("const short = openUntilShortened(current.openUntil, next.openUntil, tzOf(body, dev));") /* (batch 35 §54) */;
    expect(src("components/FieldChecks.tsx")).toContain("for (const msg of notShownYet(messages, shown)) {");
  });
});

describe("batch 35 §31: every mistake under the one heading", () => {
  it("an orphan-only refusal is a bullet with a count of 1; blanks go; the same text once", () => {
    const one = mistakeBullets([], ["The build link must start with https://"]);
    expect(one).toEqual({ items: [], extra: ["The build link must start with https://"], n: 1 });
    const el = {} as HTMLElement;
    const mix = mistakeBullets([{ el, text: "Enter the product name." }, { el, text: "  " }, { el, text: "Enter the product name." }], ["", "Enter the product name.", " Too many spots. "]);
    expect(mix.items.map((i) => i.text)).toEqual(["Enter the product name."]);
    expect(mix.extra).toEqual(["Too many spots."]);
    expect(mix.n).toBe(2);
    expect(needsFixingLine("Open until")).toBe("Open until needs fixing.");
    expect(needsFixingLine("")).toBe("A field needs fixing.");
  });

  it("a red field with no line text gets its name; the list never shows a loose red line", () => {
    const fc = src("components/FieldChecks.tsx");
    expect(fc).toContain(".trim() || needsFixingLine(fieldNameOf(el));");
    expect(fc).toContain("if (!out.some((x) => x.el === el || x.text === text)) out.push({ el, text }); // the same line once");
    expect(fc).toContain("const { items: shownItems, extra, n } = mistakeBullets(items, left);") /* (batch 35 §57) orphans go on the next change */;
    expect(fc).not.toContain("items.length === 0 && extra.map((o) => <p");
    expect(fc).toContain('{extra.map((o) => <li key={o} data-mistake-orphan="">{o}</li>)}');
  });
});

describe("batch 35 §32: the tester deadline a tester joining now gets, on both sides", () => {
  it("one helper: the test's tester days (grown by an Open until move), else opening → Open until, else the listing's days", () => {
    const createdAt = new Date("2026-11-06T12:00:00Z");
    expect(joinerDays({ testerDays: 14, openUntil: new Date("2026-11-20T23:59:00Z"), createdAt, deadlineDays: 7 })).toBe(14);
    expect(joinerDays({ testerDays: null, openUntil: new Date("2026-11-20T23:59:00Z"), createdAt, deadlineDays: 7 })).toBe(14);
    expect(joinerDays({ testerDays: null, openUntil: null, createdAt, deadlineDays: 7 })).toBe(7);
    expect(src("app/app/find/[id]/page.tsx")).toContain("const days = joinerDays(t);");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("const listingNow = { ...asListing(t), deadlineDays: joinerDays(t) };");
  });

  it("the same words on both panels: “14 days from joining”", () => {
    const l = {
      productName: "", title: "", description: "", buildUrl: "", questions: [], ndaText: "", devices: [], languages: [], categories: [], mature: false, matureWhy: "",
      writtenCents: null, writtenRequired: false, recordingCents: null, recordingRequired: false, liveRateCents: null, liveMinutes: null, liveRequired: false,
      openUntil: null, joinMode: "anyone", spots: 3, deadlineDays: 14,
    } as unknown as Listing;
    const row = (side: "developer" | "tester") => panelRows(l, null, side).find((r) => r.key === "deadlineDays")!.now;
    expect(row("developer")).toBe("14 days from joining");
    expect(row("tester")).toBe("14 days from joining");
  });
});

describe("batch 35 §33: the developer's tester rows keep only the terms line", () => {
  it("no contract-change lines under it (still recorded for the tester's own page)", () => {
    const p = src("app/app/tests/[id]/page.tsx");
    expect(p).not.toContain("data-contract-notes");
    expect(p).not.toContain("notesByContract");
    expect(p).toContain('{termsRows.get(c.id) && <p className="note">{termsRows.get(c.id)}</p>}');
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("contractNotes");
  });
});

const later = () => new Promise((r) => setTimeout(r, 30));
const editAs = async (testId: string, cookie: string, fields: Record<string, unknown>, tab: string) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, confirmed: true, tab });
};
type LiveLine = { text: string; at: string; key?: string; keys?: string[]; listing?: boolean; saveAt?: string };
const liveLines = async (cookie: string, scope: string, since: string, tab = "") => {
  await later();
  const r = await json(await liveGET(req(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(since)}`, { cookie, headers: tab ? { "x-tab": tab } : {} })));
  return r.body.changes as LiveLine[];
};

describe("batch 35 §34: all listing changes since the page's seen time are ONE line", () => {
  it("developer: two saves in another tab (a rename among them) → one “You saved the listing in another tab”, See it marks the union", async () => {
    const { dev, testId } = await setup();
    await later();
    const pageLoaded = seen();
    await later();
    expect((await editAs(testId, dev.cookie, { title: "Harbor Run: nights", description: "Sail at night" }, "tab-a")).status).toBe(200);
    await later();
    expect((await editAs(testId, dev.cookie, { buildUrl: "https://example.com/v2" }, "tab-a")).status).toBe(200);
    const lines = (await liveLines(dev.cookie, `test:${testId}`, pageLoaded, "tab-b")).filter((c) => c.listing || /listing|renamed/.test(c.text));
    expect(lines.map((c) => c.text)).toEqual([SAVED_ELSEWHERE_LINE]);
    expect(lines[0].key).toBe("listing");
    expect(lines[0].keys).toEqual(["title", "description", "buildUrl"]);
    const saves = await db.testEvent.findMany({ where: { testId, kind: "listing_saved" }, orderBy: { createdAt: "desc" } });
    expect(new Date(lines[0].saveAt!).getTime()).toBe(saves[0].createdAt.getTime()); // the newest Save: the panel redraws to it first
    // A press stops once with the same one line.
    const r = await act(testId, "next-round", dev.cookie, { seenAt: pageLoaded, tab: "tab-b" });
    const texts: string[] = (r.body.error?.changes ?? []).map((c: { text: string }) => c.text);
    expect(texts.filter((t) => /listing|renamed/.test(t))).toEqual([SAVED_ELSEWHERE_LINE]);
  });

  it("tester: the developer's edits → one “<Dev> edited the listing”, covering every field", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await later();
    const pageLoaded = seen();
    await later();
    expect((await editAs(testId, dev.cookie, { description: "Sail at night" }, "tab-a")).status).toBe(200);
    await later();
    expect((await editAs(testId, dev.cookie, { devices: ["Mac"] }, "tab-a")).status).toBe(200);
    const lines = (await liveLines(j.tester.cookie, `session:${j.sessionId}`, pageLoaded)).filter((c) => /listing/.test(c.text));
    const devName = (await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).name!;
    expect(lines.map((c) => c.text)).toEqual([editedLine(devName)]);
    expect(lines[0].keys).toEqual(["description", "devices"]);
  });

  it("a Save's consequences keep their own lines; a later line replaces the box's earlier one and covers its fields", () => {
    expect(consequenceLine("re-sent fbbb's invite")).toBe("You re-sent fbbb's invite (the listing changed)");
    expect(consequenceLine("closed Ana's invite (fewer spots)")).toBe("You closed Ana's invite (fewer spots)");
    expect(panelKeysOf(["writtenCents", "title", "liveRateCents"])).toEqual(["title", "parts", "call"]);
    const box = mergeChanges(
      [{ text: SAVED_ELSEWHERE_LINE, at: "2026-10-31T10:00:00.000Z", key: "listing", listing: true, keys: ["title"] }],
      [{ text: SAVED_ELSEWHERE_LINE, at: "2026-10-31T10:05:00.000Z", key: "listing", listing: true, keys: ["buildUrl"] }],
    );
    expect(box).toEqual([{ text: SAVED_ELSEWHERE_LINE, at: "2026-10-31T10:05:00.000Z", key: "listing", listing: true, keys: ["title", "buildUrl"] }]);
    expect(src("components/LiveTop.tsx")).toContain("if (added.length) setLines((old) => mergeChanges(old, added));");
    expect(src("components/ListingInfo.tsx")).toContain('if (plan === "mark") return mark(el, covered(el, d.keys));');
    for (const f of ["components/ChangesBox.tsx", "components/GapDialog.tsx", "components/LiveTop.tsx"]) expect(src(f), f).toMatch(/seeItClick\(e, [^)]*\.keys\)/);
  });
});

describe("batch 35 §35: no Developer / Tester ticks on the Developers and Testers pages", () => {
  it("a list that shows one side drops the role ticks; the general Accounts list keeps them", () => {
    const p = src("app/admin/PagedList.tsx");
    expect(p).toContain('{search.ticks.filter((t) => !(sideFilter && "group" in t && t.group === "role")).map((t) => (');
    expect(src("app/admin/developers/page.tsx")).toContain('sideFilter="developer"');
    expect(src("app/admin/testers/page.tsx")).toContain('sideFilter="tester"');
  });
});

describe("batch 35 §36: every admin reason box as wide as the panel, its button below", () => {
  it("AdminButton with a box is stacked; Decide's note, the hold-lift note and the close-out reason too", () => {
    const b = src("app/admin/AdminButton.tsx");
    expect(b).toContain("const stack = stacked || fields.length > 0;");
    expect(b).toContain('<span key={f.name} className="flex w-full flex-col">');
    expect(b).not.toContain('"w-64"');
    expect(src("app/admin/DisputeDecision.tsx")).toContain('<div className="flex w-full flex-col items-start gap-2" data-admin-box="stacked">');
    expect(src("app/admin/DisputeDecision.tsx")).not.toContain("w-72");
    expect(src("app/admin/PagedList.tsx")).not.toContain("w-72");
    expect(src("app/admin/TeamCloseBox.tsx")).not.toContain("max-w-xl");
  });
});

describe("batch 35 §39: “Use saved” only where a saved version exists", () => {
  it("Pay / Pay more, the admin's Decide and written answers never sent read Discard", async () => {
    const { DISCARD_ALL_LABEL, DISCARD_LABEL, draftButtonLabel } = await import("@/lib/useKept");
    expect(DISCARD_ALL_LABEL).toBe("Discard all");
    expect(draftButtonLabel("discard")).toBe(DISCARD_LABEL);
    const pay = src("app/app/tests/[id]/PayBox.tsx");
    expect(pay).toContain('<DraftTag disabled={busy} kind="discard" onUseSaved={useSaved} />');
    expect(pay).not.toContain('kind="saved"');
    // Discard: the amount back to its start (the listing amount for Pay, blank for Pay more), the note emptied, the ticks off.
    expect(pay).toContain('const startAmount = start == null ? "" : (start / 100).toFixed(2);');
    expect(pay).toMatch(/const useSaved = \(\) => \{\n    setReason\(""\);\n    setAmount\(startAmount\);\n    setRate\(startRate\);\n    setTicked\(false\);\n    setOver200\(false\);/);
    const decide = src("app/admin/DisputeDecision.tsx");
    expect(decide.match(/<DraftTag /g)?.length).toBe(1);
    expect(decide).toContain('onUseSaved={() => { setTotal(""); setNote(""); setTickedFor(null); }}');
    const w = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(w).toContain('const answerKind = update ? "saved" : "discard";');
    expect(w).toContain("{update ? USE_SAVED_ALL_LABEL : DISCARD_ALL_LABEL}");
    // Where something is saved: Edit and a saved draft (draftKind), the profile.
    expect(src("app/app/profile/ProfileForm.tsx")).toContain('<DraftTag disabled={busy} kind="saved" onUseSaved={useSaved} />');
    expect(src("app/app/tests/TestForm.tsx")).toContain('const draftKind = isNew ? "discard" : "saved";');
  });
});
