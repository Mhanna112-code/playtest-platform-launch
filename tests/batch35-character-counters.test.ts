import React, { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CharacterCount } from "@/components/CharacterCount";
import { CountedInput } from "@/components/CountedInput";
import { PasswordInput } from "@/components/PasswordInput";
import { KeyCounts } from "@/components/KeyCounts";
import { WhyBox } from "@/components/WhyBox";
import { RestrictedBox } from "@/components/RestrictedBox";
import { AdminButton } from "@/app/admin/AdminButton";
import { withoutAttachmentMarkers } from "@/lib/answerAttachments";
import { answerChars } from "@/lib/questions";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));
(globalThis as unknown as { React: typeof React }).React = React;
const invalid = (html: string) => html.includes('data-count-invalid=""');

describe("owner: every limited text field shows its current count", () => {
  it.each([
    { value: "", min: 5, required: true, bad: true },
    { value: "", min: 5, required: false, bad: false },
    { value: "   ", min: 5, required: false, bad: false },
    { value: "abc", min: 5, required: false, bad: true },
    { value: " abc ", min: 5, required: true, bad: true },
    { value: "abcde", min: 5, required: true, bad: false },
    { value: "x".repeat(10), min: 0, required: false, bad: false },
    { value: "x".repeat(11), min: 0, required: false, bad: true },
  ])("counts and colors $value (minimum $min, required $required)", ({ value, min, required, bad }) => {
    const html = render(h(CharacterCount, { value, min, max: 10, required }));
    expect(html).toContain(`${value.length} / 10`);
    expect(invalid(html)).toBe(bad);
    expect(html).toContain(bad ? "text-rose-300" : "text-slate-500");
  });
  it("counts marker-free written text and uses the same formatted-text minimum as Send", () => {
    const value = "Hello [📎 picture.png #abcd]";
    const html = render(h(CharacterCount, { value, count: withoutAttachmentMarkers(value).length, minCount: answerChars(value), min: 50, max: 50000 }));
    expect(html).toContain("6 / 50,000 (at least 50)"); expect(invalid(html)).toBe(true);
  });
  it("the signup name and new password have counts even in native forms", () => {
    const name = render(h(CountedInput, { name: "name", defaultValue: "Alex", minLength: 1, maxLength: 80, required: true }));
    expect(name).toContain("4 / 80");
    const password = render(h(PasswordInput, { autoComplete: "new-password", defaultValue: "short", minLength: 8 }));
    expect(password).toContain("5 / 200 (at least 8)"); expect(invalid(password)).toBe(true);
    const full = render(h(PasswordInput, { autoComplete: "new-password", defaultValue: "12345678", minLength: 8 }));
    expect(invalid(full)).toBe(false);
  });
  it("Stop and End early count below the minimum immediately", () => {
    const html = render(h(WhyBox, { id: "why", label: "Why", placeholder: "Why", requiredMsg: "Say why", match: "why", value: "abc", onChange() {}, max: 10000, countAttr: "data-stop-count" }));
    expect(html).toContain('data-stop-count=""'); expect(html).toContain("3 / 10,000"); expect(invalid(html)).toBe(true);
  });
  it("required admin reasons are red below minimum; optional notes start neutral", () => {
    const props = { id: "person", label: "Suspend", fields: [{ name: "note", label: "Why" }] };
    const required = render(h(AdminButton, { ...props, action: "suspend" }));
    expect(required).toContain("0 / 1,000 (at least 3)"); expect(invalid(required)).toBe(true);
    const optional = render(h(AdminButton, { ...props, action: "pause-test" }));
    expect(optional).toContain("0 / 1,000"); expect(invalid(optional)).toBe(false);
  });
  it("access keys count each line and flag only the key exceeding its own limit", () => {
    const html = render(h(KeyCounts, { value: "ABC\n" + "X".repeat(201) }));
    expect(html).toContain("3 / 200"); expect(html).toContain("201 / 200");
    expect(html.match(/data-count-invalid=/g)).toHaveLength(1);
  });
  it("the suspended tester dashboard visibly explains access to disputes, even with a refused press", () => {
    const html = render(h(RestrictedBox, { tester: true, developer: false, kinds: ["suspended"], failed: "Your Send did not go through" }));
    expect(html).toContain("You can still dispute payments for work you sent: open the test from your dashboard.");
    expect(html).toContain("What you sent is still reviewed and paid as usual.");
    expect(html).not.toContain("once your account is active again");
    expect(html).not.toContain("position:fixed");
  });
});
