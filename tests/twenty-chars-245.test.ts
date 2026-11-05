import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { LIMITS, NAME_TOO_LONG, fitName } from "@/lib/limits";
import { checkListing } from "@/lib/rules";
import { CountedInput } from "@/components/CountedInput";
import { Cut, NameLink, TestName, cutText, neverCut } from "@/components/Cut";
import { WhatLine } from "@/components/WholeLine";
import { BELL_LINE_SHOWN, LINE_BOX_OVER, opensInBox } from "@/lib/bell";
import { splitLead } from "@/lib/bankTop";
import { bellWords } from "@/app/app/notifications/BellList";
import { OwedReadOnly } from "@/components/PaymentLists";
import { ConfirmList } from "@/app/app/payments/ConfirmList";
import { readNewAccount } from "@/lib/server/passwords";
import { saveProfile } from "@/lib/server/users";
import { owedSplit } from "@/lib/server/holds";
import { finishGoogle, GOOGLE_COOKIE, pendingGoogleSignup, startGoogleSignup } from "@/lib/server/google";
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { email, json, makeUser, req, uniq } from "./helpers";

// (Owner, Nov 5, batch 35 §245) Person names and test titles are at most 20 characters, so nothing is ever cut ("…") or needs expanding; test names show green.
// (§246) Every payment row, confirm row and bell line: the "what" cut at 30 and opened in place as plain text (the box only over 200).
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const NAME20 = "Alexandria Montgomer"; // 20
const NAME21 = "Alexandria Montgomery"; // 21

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("§245 the limits", () => {
  it("person names, test titles and product names: 20 each", () => {
    expect(LIMITS.personName).toBe(20);
    expect(LIMITS.testName).toBe(20);
    expect(LIMITS.productName).toBe(20); // (owner, Nov 5; was 60)
    expect(NAME_TOO_LONG).toBe("Keep your name to 20 characters.");
    expect(NAME20).toHaveLength(20);
    expect(NAME21).toHaveLength(21);
  });

  it("Post, Edit and Next round refuse a title over 20 with the existing line; 20 is fine; an older long title stays until it is edited", () => {
    const base = { productName: "Harbor Run", title: "x".repeat(20), description: "Play the first level." } as Parameters<typeof checkListing>[0];
    const l = (title: string) => ({ ...base, title }) as Parameters<typeof checkListing>[0];
    expect(checkListing(l("x".repeat(21)))).toContain("Keep the title to 20 characters.");
    expect(checkListing(l("x".repeat(20)))).not.toContain("Keep the title to 20 characters.");
    expect(checkListing(l("x".repeat(30)), 0, new Date(), { changed: new Set(["description"]) })).not.toContain("Keep the title to 20 characters.");
    // (Owner, Nov 5) The product name the same: 20, its existing line; an older longer one stays until it is edited.
    expect(checkListing({ ...base, productName: "p".repeat(21) } as Parameters<typeof checkListing>[0])).toContain("Keep the product name to 20 characters.");
    expect(checkListing({ ...base, productName: "p".repeat(20) } as Parameters<typeof checkListing>[0])).not.toContain("Keep the product name to 20 characters.");
    expect(checkListing({ ...base, productName: "p".repeat(30) } as Parameters<typeof checkListing>[0], 0, new Date(), { changed: new Set(["description"]) })).not.toContain("Keep the product name to 20 characters.");
    // The counters on Post / Edit read their limits from the table.
    expect(src("src/app/app/tests/TestForm.tsx")).toContain('max: LIMITS.testName, min: TITLE_MIN_CHARS');
    expect(src("src/app/app/tests/TestForm.tsx")).toContain("max: LIMITS.productName");
  });
});

describe("§245 a person's name: refused over 20, never cut silently", () => {
  const body = { role: "developer", acceptTerms: "yes", over18: "yes" };
  it("sign-up (email form and Google's step): a field mistake at Name; 20 characters go through as typed", async () => {
    expect(() => readNewAccount({ ...body, name: NAME21 })).toThrow(NAME_TOO_LONG);
    expect(readNewAccount({ ...body, name: `  ${NAME20}  ` }).name).toBe(NAME20);
    const r = await json(await signupPOST(req("/api/auth/signup", { body: { ...body, email: email("long"), password: "harbor-run-1", name: NAME21 } })));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "bad_field" });
    expect(r.body.error.message.split("\n")).toContain(NAME_TOO_LONG);
    // The line goes to the Name box (its data-match), red there.
    expect(new RegExp("your name", "i").test(NAME_TOO_LONG)).toBe(true);
    expect(src("src/lib/server/passwords.ts")).not.toContain("slice(0, 80)");
  });

  it("the profile's name: the same rule", async () => {
    const u = await makeUser({ dev: true, name: "Nora Lane" });
    await expect(saveProfile(u.user.id, { name: NAME21, isDeveloper: true, side: "developer" })).rejects.toThrow(NAME_TOO_LONG);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).name).toBe("Nora Lane");
    expect((await saveProfile(u.user.id, { name: NAME20, isDeveloper: true, side: "developer" })).name).toBe(NAME20);
  });

  it("the live counters: sign-up, Google's step and the profile count to 20", () => {
    expect(render(h(CountedInput, { name: "name", defaultValue: NAME20, minLength: 1, maxLength: LIMITS.personName, required: true }))).toContain("20 / 20");
    for (const f of ["src/app/signup/page.tsx", "src/app/signup/google/page.tsx"]) expect(src(f), f).toContain("<CountedInput minLength={1} maxLength={LIMITS.personName}");
    expect(src("src/app/app/profile/ProfileForm.tsx")).toContain("<CharacterCount value={v.name} min={1} max={LIMITS.personName} required />");
  });

  it("Google: a name over 20 is cut to its first 20 characters (trimmed) for the step's Name box, editable there", async () => {
    expect(fitName("Maximiliana Alexandrina Lopez")).toBe("Maximiliana Alexandr");
    expect(fitName("Ana Maria Silva Costa Pereira")).toBe("Ana Maria Silva Cost");
    expect(fitName("Ana Maria Silva     Costa")).toBe("Ana Maria Silva"); // spaces at the end trimmed
    expect(fitName("  Ana Silva  ")).toBe("Ana Silva");
    expect(fitName("😀".repeat(15)).length).toBeLessThanOrEqual(20); // never splits an emoji
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    const mail = email("g");
    const claims = { iss: "https://accounts.google.com", aud: "cid", exp: Math.floor(Date.now() / 1000) + 600, email: mail, email_verified: true, name: "Maximiliana Alexandrina Lopez" };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id_token: `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig` }), { status: 200 }));
    const done = await finishGoogle(new Request("http://localhost:3400/api/auth/google/callback?code=c&state=s", { headers: { cookie: `${GOOGLE_COOKIE}=s.v` } }));
    const step = await pendingGoogleSignup((done as { pending: string }).pending);
    expect(step).toEqual({ email: mail, name: "Maximiliana Alexandr" });
    // No name from Google: the box starts empty, as before.
    expect((await pendingGoogleSignup(await startGoogleSignup(email("g2"))))?.name).toBe("");
    expect(src("src/app/signup/google/page.tsx")).toContain("defaultValue={step.name}");
  });

  it("admin-made and test-fixture accounts stay valid (the database has no limit; only the forms refuse)", async () => {
    const u = await makeUser({ name: NAME21 });
    expect(u.user.name).toBe(NAME21);
  });
});

describe("§245 the migration shortens existing names and titles (first 20 characters, right-trimmed)", () => {
  const dir = path.resolve(__dirname, "../prisma/migrations/20261119090000_names_twenty/migration.sql");
  const sql = readFileSync(dir, "utf8");
  it("its statements", () => {
    expect(sql).toContain('UPDATE "User" SET "name" = rtrim(left("name", 20)) WHERE char_length("name") > 20;');
    expect(sql).toContain('UPDATE "Test" SET "title" = rtrim(left("title", 20)) WHERE char_length("title") > 20;');
    expect(sql).toContain('UPDATE "Contract" SET "title" = rtrim(left("title", 20)) WHERE char_length("title") > 20;');
    for (const t of ['"Application" SET "listing"', '"TestChange" SET "before"', '"TestChange" SET "after"']) expect(sql).toContain(`UPDATE ${t} = jsonb_set(`);
    expect(sql).toContain('UPDATE "Test" SET "productName" = rtrim(left("productName", 20)) WHERE char_length("productName") > 20;');
    for (const t of ['"Application" SET "listing"', '"TestChange" SET "before"', '"TestChange" SET "after"']) expect(sql).toContain(`UPDATE ${t} = jsonb_set("${t.split('"')[3]}", '{productName}'`);
    expect(sql).not.toMatch(/"Notification"|"TestEvent"|"ContractNote"|"Payment"/);
  });

  it("run on rows of its own: long ones shortened and trimmed, short ones untouched", async () => {
    const dev = await makeUser({ dev: true, name: "Maximiliana Alexandr  ina" });
    const short = await makeUser({ name: "Ana Silva" });
    const tester = await makeUser({ tester: true });
    const t = await db.test.create({ data: { developerId: dev.user.id, title: "Underwater Harbor Run Deluxe", productName: "Underwater Harbor Run Deluxe Edition", description: "d", buildUrl: "", devices: [], languages: [], spots: 2, deadlineDays: 7 } });
    const c = await db.contract.create({ data: { testId: t.id, testerId: tester.user.id, listingVersion: 1, title: "Underwater Harbor Run Deluxe", buildUrl: "", description: "d", deadlineDays: 7, questions: [], dueAt: new Date() } as never });
    const a = await db.application.create({ data: { testId: t.id, testerId: short.user.id, listing: { title: "Underwater Harbor Run Deluxe", productName: "Underwater Harbor Run Deluxe Edition", spots: 2 } } });
    const ch = await db.testChange.create({ data: { testId: t.id, fields: ["title"], before: { title: "Underwater Harbor Run Deluxe" }, after: { title: "Harbor Run" } } });
    // Each statement, limited to these rows (the test schema is shared with other files running now).
    const only: Record<string, string> = { User: `'${dev.user.id}','${short.user.id}'`, Test: `'${t.id}'`, Contract: `'${c.id}'`, Application: `'${a.id}'`, TestChange: `'${ch.id}'` };
    for (const stmt of sql.split(";").map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) {
      const table = /^UPDATE "(\w+)"/.exec(stmt)![1];
      await db.$executeRawUnsafe(`${stmt} AND "id" IN (${only[table]})`);
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).name).toBe("Maximiliana Alexandr");
    expect((await db.user.findUniqueOrThrow({ where: { id: short.user.id } })).name).toBe("Ana Silva");
    const t2 = await db.test.findUniqueOrThrow({ where: { id: t.id } });
    expect([t2.title, t2.productName]).toEqual(["Underwater Harbor Ru", "Underwater Harbor Ru"]);
    expect((await db.contract.findUniqueOrThrow({ where: { id: c.id } })).title).toBe("Underwater Harbor Ru");
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).listing).toEqual({ title: "Underwater Harbor Ru", productName: "Underwater Harbor Ru", spots: 2 });
    const ch2 = await db.testChange.findUniqueOrThrow({ where: { id: ch.id } });
    expect([ch2.before, ch2.after]).toEqual([{ title: "Underwater Harbor Ru" }, { title: "Harbor Run" }]);
  });
});

describe("§245 no '…' and nothing to expand for a name or a test title", () => {
  it("Cut never cuts a person's, a test's or a product's name (also `fit`: it wraps); only an email still is", () => {
    expect(neverCut("person") && neverCut("test") && neverCut("product") && !neverCut("email")).toBe(true);
    expect(cutText(NAME21)).toBe(NAME21);
    expect(cutText("Untitled draft (round 2)", "test")).toBe("Untitled draft (round 2)");
    expect(cutText("Underwater Harbor Run Deluxe", "product")).toBe("Underwater Harbor Run Deluxe");
    expect(cutText("maximiliana.alexandrina@playtest.test", "email")).toBe("maximiliana.alexandr…@playtest.test");
    expect(render(h(Cut, { text: NAME21 }))).toBe(NAME21);
    const fit = render(h(Cut, { text: NAME21, fit: true }));
    expect(fit).toBe(`<span class="[overflow-wrap:anywhere]" data-name-wraps="person">${NAME21}</span>`);
    expect(fit).not.toContain("truncate");
    expect(render(h(Cut, { text: "Harbor Run", kind: "test", fit: true }))).not.toContain("truncate");
    expect(render(h(NameLink, { text: NAME20, href: "/app/testers/t1", fit: true }))).not.toContain("inline-block");
    expect(render(h(Cut, { text: "Underwater Harbor Run Deluxe", kind: "product", fit: true }))).not.toContain("truncate");
    // The product kickers (Find, the dashboards, Tests visited): whole, never cut; no green link (a product isn't a page). The Listing panel never cut it (§231's box).
    for (const f of ["src/app/app/page.tsx", "src/app/app/TestsVisited.tsx"]) expect(src(f), f).not.toContain('className="kicker truncate"');
    expect(src("src/app/app/find/page.tsx")).toContain('<p className="kicker"><Cut text={t.productName} kind="product" /></p>');
  });
});

describe("§245 test names show green", () => {
  it("TestName: a green link to the test, or the same green words where a link would steal the press", () => {
    expect(render(h(TestName, { text: "Harbor Run", href: "/app/tests/t1" }))).toBe('<a href="/app/tests/t1" class="relative z-10 " data-name-link="test">Harbor Run</a>');
    expect(render(h(TestName, { text: "Harbor Run" }))).toBe('<span class="text-volt-300 [overflow-wrap:anywhere]" data-test-name="">Harbor Run</span>');
    // Links are green (globals.css: a { text-volt-300 }), as people's names are.
    expect(src("src/app/globals.css")).toContain("a { @apply text-volt-300");
  });

  it("the dashboards, Needs you, Find, Messages, calls, payments, the bell, the admin lines and the profiles use it; page headings stay", () => {
    const dash = src("src/app/app/page.tsx");
    expect(dash).not.toContain('kind="test" />'.replace("kind", "<Cut text={c.title} kind"));
    expect(dash).toContain("<b><TestName text={r.title} /></b> · {plural(r.n, \"part\")} to pay"); // Needs you
    expect(dash).toContain("<TestName text={a.c.title} href={a.href} />"); // To do
    expect(dash).toContain("<TestName text={c.title} href={`/app/sessions/${c.id}`} /> · {p.name}");
    expect(dash).toContain('<NameLink text={x.testTitle} kind="test" href={`/app/tests/${x.testId}`} />'); // already a green link
    expect(dash).not.toContain('className="text-white no-underline hover:underline" />');
    for (const f of ["src/app/app/find/page.tsx", "src/app/app/messages/page.tsx", "src/app/app/CallsBox.tsx", "src/app/app/DevSearch.tsx", "src/app/app/TestsVisited.tsx", "src/app/app/developers/[id]/page.tsx", "src/app/app/notifications/BellList.tsx", "src/app/app/payments/page.tsx", "src/app/admin/MineLine.tsx", "src/components/ExcerptList.tsx"]) {
      expect(src(f), f).toContain("<TestName text=");
      expect(src(f), f).not.toContain('<Cut text={c.title} kind="test" />');
    }
    expect(src("src/app/admin/AdminRich.tsx")).toContain("<a key={i} href={s.href}>{s.t}</a>");
    expect(src("src/app/app/tests/[id]/TopPanel.tsx")).toContain('<h1 className="text-3xl font-bold tracking-tight text-white">{p.title}</h1>');
    expect(src("src/app/app/find/[id]/page.tsx")).toContain('<h1 className="text-2xl font-bold tracking-tight text-white">{testTitleOf(t)}</h1>');
  });

  it("a bell line's test name is green wherever it appears whole", () => {
    const html = render(h("span", null, bellWords("On “Harbor Run”: Ana Silva sent $10.00 of work", "Harbor Run")));
    expect(html).toContain('“<span class="text-volt-300" data-test-name="">Harbor Run</span>”');
    expect(render(h("span", null, bellWords("Nothing about a test", "Harbor Run")))).not.toContain("data-test-name");
  });
});

describe("§246 a row's 'what': cut at 30, opened in place", () => {
  const LONG = "Ana Silva's written answers on “Harbor Run”";
  it("closed: the first 30 characters (never inside a word or an amount), '…' and the arrow; the hover the whole 'what'; `after` outside the cut", () => {
    expect(BELL_LINE_SHOWN).toBe(30);
    const html = unescape(render(h(WhatLine, { text: LONG, after: h("span", { "data-amount": "" }, " · $10.00") })));
    expect(html).toContain(`<span title="${LONG}" data-what-cut=""><span data-what-text="">Ana Silva's written answers on…</span></span>`);
    expect(html).toContain('data-whole-toggle=""');
    expect(html).toMatch(/<\/button><span data-amount=""> · \$10\.00<\/span>$/);
    expect(html).not.toContain("data-name-toggle");
  });
  it("30 characters or fewer: whole, no arrow", () => {
    const html = render(h(WhatLine, { text: "x".repeat(30), after: " · $5.00" }));
    expect(html).toBe(`<span data-what-text="">${"x".repeat(30)}</span> · $5.00`);
  });
  it("opened: inline and wrapped, no box; only a 'what' over 200 characters opens in the draggable box", () => {
    expect(LINE_BOX_OVER).toBe(200);
    expect(opensInBox("x".repeat(200))).toBe(false);
    expect(opensInBox("x".repeat(201))).toBe(true);
    const open = unescape(render(h(WhatLine, { text: LONG, startOpen: true, after: " · $10.00" })));
    expect(open).toContain(`<span class="whitespace-pre-wrap [overflow-wrap:anywhere]" data-what-open=""><span data-what-text="">${LONG}</span></span>`);
    expect(open).not.toContain("data-panel");
    expect(open).toContain(" · $10.00");
    const note = `The team paused your tests: ${"a long typed note ".repeat(12)}`;
    const box = render(h(WhatLine, { text: note, startOpen: true }));
    expect(box).toContain('data-what-box=""');
    expect(box).toContain("data-panel=");
  });
  it("links: the test's green link inside the opened text (confirm rows' render), the row's link around it (payment rows)", () => {
    const html = render(h(WhatLine, { text: LONG, startOpen: true, href: "/app/tests/t1" }));
    expect(html).toContain('<a class="hover:underline" href="/app/tests/t1" data-what-text="">');
  });

  it("each kind of row uses it: What you've paid, refunds, group items, owed lines, covers, a part's payments, the charges waiting, the confirm rows", () => {
    for (const f of ["src/components/PaymentLists.tsx", "src/components/PartPayments.tsx", "src/components/OwedBox.tsx", "src/app/app/payments/page.tsx", "src/app/app/payments/ConfirmList.tsx", "src/components/BankWaiting.tsx"]) {
      expect(src(f), f).toContain("<WhatLine text=");
      expect(src(f), f).not.toContain("<WholeLine");
    }
    expect(src("src/app/app/BankToConfirm.tsx")).toContain("before={lead.amount ?");
    expect(src("src/components/PaymentLists.tsx")).toContain("<span data-paid-group-what=\"\">{g.label}</span>"); // group headers aren't cut
  });

  it("an owed line: the payment named is cut, its amount, status and date always shown", () => {
    expect(owedSplit("Your bank reversed $10 you paid for Ana Silva's written answers on “Harbor Run”: $10 + $15 chargeback fee")).toEqual({ what: "Your bank reversed $10 you paid for Ana Silva's written answers on “Harbor Run”", rest: ": $10 + $15 chargeback fee" });
    const line = { id: "o1", retry: false, amountCents: 1000, until: null, text: `${LONG} $10.00 · charged by the tester while your tests were paused`, full: `${LONG} $10.00 · charged by the tester while your tests were paused`, what: LONG, rest: " $10.00 · charged by the tester while your tests were paused" };
    const html = unescape(render(h(OwedReadOnly, { owed: { lines: [line] as never, totalCents: 1000 } })));
    expect(html).toContain("Ana Silva's written answers on…</span></span><button");
    expect(html).toContain('<span data-owed-rest=""> $10.00 · charged by the tester while your tests were paused</span>');
  });

  it("a confirm row: the 'what' cut, its amount and 'confirm by' outside; Confirm with your bank outside", () => {
    const item = { id: "p1", what: "A payment for Ana Silva's written answers on “Harbor Run”", amount: "$10.00", by: "confirm by Nov 7, 3:00 PM", text: "x", href: "/app/tests/t1#bank-p1", tests: [{ name: "“Harbor Run”", href: "/app/tests/t1" }] };
    const html = unescape(render(h(ConfirmList, { items: [item] })));
    expect(html).toContain("A payment for Ana Silva's…</span></span><button");
    expect(html).toContain('data-confirm-amount="">$10.00</span> · confirm by Nov 7, 3:00 PM');
    expect(html).toContain("Confirm with your bank →</a>");
  });

  it("the dashboard's lead splits at its amount", () => {
    expect(splitLead("$12.50 · Ana Silva's written answers on “Harbor Run”")).toEqual({ amount: "$12.50", sep: " · ", what: "Ana Silva's written answers on “Harbor Run”" });
    expect(splitLead("$5.00 on “Harbor Run” · what you owe")).toEqual({ amount: "$5.00", sep: " ", what: "on “Harbor Run” · what you owe" });
    expect(splitLead("$9.00 for your plan")).toEqual({ amount: "$9.00", sep: " ", what: "for your plan" });
    expect(splitLead("$1,234.00 · x")).toEqual({ amount: "$1,234.00", sep: " · ", what: "x" });
  });

  it("the bell: the same open rule (inline; the box only over 200)", () => {
    const b = src("src/app/app/notifications/BellList.tsx");
    expect(b).toContain("opensInBox(l.text) ? <OwnPanel><ResizeBox");
    expect(uniq()).toHaveLength(10);
  });
});
