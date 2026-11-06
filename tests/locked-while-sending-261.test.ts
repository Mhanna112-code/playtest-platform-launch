import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LOCKED_TEXT_SELECTOR, SEND_LOCKED_ATTR, lockInside, lockPick, lockText } from "@/lib/sendLock";
import { WhyBox } from "@/components/WhyBox";
import { BioBox } from "@/components/BioBox";
import { RequestRows } from "@/components/RequestRows";
import { WrittenAddForm } from "@/app/app/sessions/[id]/SessionActions";

// (Owner, Nov 5, §261) "Disable typing in boxes while their send is going through."
(globalThis as unknown as { React: typeof React }).React = React; // the app's components are compiled with the classic JSX runtime here
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("§261 the shared lock", () => {
  it("a sent box is read-only (not disabled) and marked while sending; as before otherwise", () => {
    expect(lockText(true)).toEqual({ readOnly: true, "aria-readonly": true, [SEND_LOCKED_ATTR]: "" });
    expect(lockText(false)).toEqual({});
    expect("disabled" in lockText(true)).toBe(false);
    expect(lockPick(true)).toEqual({ disabled: true, [SEND_LOCKED_ATTR]: "" });
    expect(lockPick(false)).toEqual({});
  });

  it("one subtle look for every locked box: dimmed, cursor-not-allowed", () => {
    const css = src("app/globals.css");
    expect(css).toMatch(/\[data-send-locked\][^{]*\{ opacity: 0\.6; cursor: not-allowed; \}/);
  });

  it("lockInside locks only boxes that weren't read-only, disables pickers and Use theirs, and puts back exactly those", () => {
    type El = { readOnly?: boolean; disabled?: boolean; attrs: Record<string, string>; setAttribute(k: string, v: string): void; removeAttribute(k: string): void };
    const el = (o: Partial<El>): El => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, ...o });
    const typed = el({ readOnly: false }), already = el({ readOnly: true }), picker = el({ disabled: false }), theirs = el({ disabled: false }), off = el({ disabled: true });
    const root = { querySelectorAll: (sel: string) => (sel === LOCKED_TEXT_SELECTOR ? [typed, already] : [picker, theirs, off]) } as unknown as ParentNode;
    const undo = lockInside(root);
    expect(typed.readOnly).toBe(true);
    expect(typed.attrs[SEND_LOCKED_ATTR]).toBe("");
    expect(already.attrs[SEND_LOCKED_ATTR]).toBeUndefined();
    expect([picker.disabled, theirs.disabled, off.disabled]).toEqual([true, true, true]);
    undo();
    expect(typed.readOnly).toBe(false);
    expect(typed.attrs).toEqual({});
    expect(already.readOnly).toBe(true); // it was read-only before: it stays so
    expect([picker.disabled, theirs.disabled, off.disabled]).toEqual([false, false, true]);
    expect(LOCKED_TEXT_SELECTOR).toContain("textarea");
    expect(src("lib/sendLock.ts")).toContain("button[data-use-theirs]");
  });
});

describe("§261 boxes drawn locked", () => {
  it("WhyBox (Stop, End early) is read-only while its press goes, editable otherwise", () => {
    const props = { id: "r", label: "Why?", placeholder: "", requiredMsg: "Say why", match: "why", value: "We are done", onChange: () => {}, max: 100, countAttr: "data-end-count" };
    const on = renderToStaticMarkup(createElement(WhyBox, { ...props, locked: true }));
    expect(on).toMatch(/<textarea[^>]*readOnly=""[^>]*data-send-locked=""/);
    expect(on).toContain("We are done"); // the text stays there, readable
    expect(on).not.toMatch(/<textarea[^>]*disabled/);
    expect(renderToStaticMarkup(createElement(WhyBox, props))).not.toMatch(/readonly|data-send-locked/i);
  });

  it("BioBox (profile Save) the same", () => {
    const props = { shownTo: "testers" as const, value: "Bio", onChange: () => {}, placeholder: "" };
    expect(renderToStaticMarkup(createElement(BioBox, { ...props, locked: true }))).toMatch(/<textarea[^>]*readOnly=""/);
    expect(renderToStaticMarkup(createElement(BioBox, props))).not.toMatch(/readonly/i);
  });

  it("call request rows: times read-only, repeat, Remove and + Another time disabled", () => {
    const rows = [{ when: "2030-01-01T10:00", repeat: "once", count: "2" }, { when: "", repeat: "once", count: "2" }] as never;
    const on = renderToStaticMarkup(createElement(RequestRows, { rows, setRows: () => {}, minNow: "2029-01-01T00:00", locked: true }));
    expect(on).toMatch(/<input type="datetime-local"[^>]*readOnly=""/);
    expect(on).toMatch(/<select[^>]*disabled=""[^>]*data-send-locked=""/);
    expect(on).toMatch(/<button[^>]*disabled=""[^>]*data-send-locked=""[^>]*>Remove<\/button>/);
    expect(on).toMatch(/<button[^>]*disabled=""[^>]*data-send-locked=""[^>]*>\+ Another time<\/button>/);
    expect(renderToStaticMarkup(createElement(RequestRows, { rows, setRows: () => {}, minNow: "2029-01-01T00:00" }))).not.toContain("data-send-locked");
  });

  it("an idle form is drawn as before (no lock)", () => {
    const h = renderToStaticMarkup(createElement(WrittenAddForm, { sessionId: "s1", seenAt: new Date().toISOString(), questionKey: "q1", question: "Q" }));
    expect(h).not.toContain("data-send-locked");
  });
});

describe("§261 every press that sends typed text locks its own boxes", () => {
  const has = (f: string, ...bits: string[]) => { const s = src(f); for (const b of bits) expect(s, `${f}: ${b}`).toContain(b); };
  it("PressButton tells its caller for the whole press (request, bank check, redraw)", () => {
    has("components/PressButton.tsx", "onSending", "const sending = going.sending || busy || bank.open;", "going.run(");
    has("app/app/tests/[id]/DisputeSide.tsx", "onSending={setSending}", "{...lockText(sending)}");
  });
  it("the tester's written answers, Add to this answer, its toolbar and file picker; the dispute reason", () => {
    has("app/app/sessions/[id]/SessionActions.tsx", "<SendingScope.Provider value={busy}>", "<SendingScope.Provider value={busy || fin.done}>", "const locked = useContext(SendingScope);",
      "{...lockText(locked)}", "{...lockPick(locked)} className=\"sr-only\"", "onClick={() => apply(\"bold\")} {...lockPick(locked)}", "{locked ? <AnswerWithAttachments text={value} attachments={attachments} /> :",
      "setReason(e.target.value)} {...lockText(busy || fin.done)}");
  });
  it("chat, reports, excerpt, Pay / Pay more, Rate, application note, charge amount", () => {
    has("components/Chat.tsx", "{...lockText(busy)}");
    has("components/ReportProblem.tsx", "{...lockText(busy)}");
    has("components/ReportButton.tsx", "{...lockText(busy)}");
    has("components/Excerpts.tsx", "{...lockText(busy)}", "{...lockPick(busy)}");
    has("app/app/tests/[id]/PayBox.tsx", "const sending = paying.sending || busy || bank.open;", "typeRate(e.target.value)} {...lockText(sending)}", "typeAmount(e.target.value)} placeholder=\"0.00\" {...lockText(sending)}", "{...lockText(sending)} />");
    has("components/RateBox.tsx", "const sending = going.sending || busy;", "{...lockText(sending)}");
    has("app/app/find/[id]/JoinBox.tsx", "{...lockText(busy || !!done)}");
    has("app/app/sessions/[id]/ChoiceBox.tsx", "{...lockText(busy)}");
  });
  it("call requests and cancel reasons lock only their own press's boxes", () => {
    has("components/CallRequests.tsx", "const sendLocked = requesting.sending || (busy && at === \"request\");", "locked={sendLocked}");
    has("app/app/tests/[id]/DevCallPanel.tsx", "const sendLocked = requesting.sending || (busy && at === \"request\");", "locked={sendLocked}");
    has("components/CancelMenu.tsx", "{...lockText(mine && p.busy)}");
    has("app/app/tests/[id]/TopPanel.tsx", "locked={sendingAs(\"stop\")}", "locked={sendingAs(\"end-early\")}");
  });
  it("admin notes: every AdminButton once, the dispute decision, the team's close, the hold's note", () => {
    has("app/admin/AdminButton.tsx", "const sending = busy || fin.done;", "{...lockText(sending)}", "{...lockPick(sending)}");
    has("app/admin/DisputeDecision.tsx", "{...lockText(busy || fin.done)}");
    has("app/admin/TeamCloseBox.tsx", "{...lockText(busy)}");
    has("app/admin/PagedList.tsx", "{...lockText(busy || fin.done)}");
  });
  it("profile, contact, Post a test / Edit and the signed-out forms", () => {
    has("app/app/profile/ProfileForm.tsx", "{...lockText(busy)}", "locked={busy}");
    has("app/app/help/ContactForm.tsx", "{...lockText(busy)}");
    has("app/app/tests/TestForm.tsx", "useLockInside(formRef, busy);");
    has("components/AuthForm.tsx", "useLockInside(form, busy);", "<form ref={form}");
  });
});
