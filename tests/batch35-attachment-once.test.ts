import React, { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { joined, setup } from "./fixtures";
import { describe, expect, it, vi } from "vitest";
import { AttachmentList } from "@/components/AttachmentList";
import { AnswerWithAttachments, SetView } from "@/components/AnswerSets";
import { SentWork } from "@/components/SentWork";
import { QuestionsChangedEntry } from "@/components/QuestionsHistory";
import { DisputeWork } from "@/app/admin/DisputeWork";
import { attachmentMarker, markerIds } from "@/lib/answerAttachments";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, adminAway() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
const image = { id: "upload-image-abcd", filename: "screen.png", contentType: "image/png", sizeBytes: 100 };
const file = { id: "upload-file-efgh", filename: "details.pdf", contentType: "application/pdf", sizeBytes: 50 };
const uploads = [image, file];
const attachments = uploads.map((f) => ({ ...f, size: f.sizeBytes }));
const marker = attachmentMarker(image.id, image.filename);
const items = [{ question: "What happened?", answer: `See ${marker} here.`, required: true }];
const href = (id: string) => `/api/recordings/${id}/file`;

describe("§115: a file placed inline is not listed again", () => {
  it("renders the inline image once and keeps only the other file in the list", () => {
    const html = render(h(React.Fragment, null, h(SetView, { items, attachments }), h(AttachmentList, { items: uploads, inlineText: items.map((it) => it.answer) })));
    expect(html.match(/<img /g)).toHaveLength(1);
    const list = html.slice(html.indexOf('<ul'));
    expect(list).not.toContain(href(image.id));
    expect(list).toContain(href(file.id));
    expect(html).toContain(`href="${href(image.id)}" target="_blank"`);
  });
  it("has no attachments list when every file is placed inline, including the older marker form", () => {
    const text = `${marker} [[attachment:${file.id}|details.pdf]]`;
    expect(render(h(AttachmentList, { items: uploads, inlineText: [text] }))).toBe("");
    const html = render(h(AnswerWithAttachments, { text, attachments }));
    expect(html).toContain(href(image.id)); expect(html).toContain(href(file.id));
  });
  it("uses the same tag and filename resolution when upload tags collide", () => {
    const other = { ...image, id: "another-image-abcd", filename: "other.png" };
    const html = render(h(AttachmentList, { items: [image, other], inlineText: [marker] }));
    expect(html).not.toContain(href(image.id)); expect(html).toContain(href(other.id));
  });
  it("a notes marker resolved to an older upload never hides another file with the same short tag", () => {
    const older = { ...image, id: "older-upload-abcd", filename: "old.png" };
    const text = "[📎 old.png #abcd]";
    const html = render(h(React.Fragment, null,
      h(AnswerWithAttachments, { text, attachments: [older, image].map((f) => ({ ...f, size: f.sizeBytes })) }),
      h(AttachmentList, { items: [image], inlineIds: [...markerIds(text, [older, image])] })));
    expect(html).toContain(`alt="old.png"`);
    expect(html.slice(html.indexOf('<ul'))).toContain(href(image.id));
  });
  it("leaves files listed when a marker is missing, malformed or for another upload", () => {
    const html = render(h(AttachmentList, { items: uploads, inlineText: ["[📎 missing.png #zzzz] [📎 screen.png]"] }));
    expect(html).toContain(href(image.id)); expect(html).toContain(href(file.id));
  });
  it("the admin's See the work also excludes an image placed in notes", () => {
    const html = render(h(DisputeWork, { work: { kind: "submission", part: "written", setUntil: null, items: [{ ...items[0], answer: "The answer" }], notes: marker, files: uploads } }));
    expect(html.match(/<img /g)).toHaveLength(1);
    const list = html.slice(html.indexOf('<ul'));
    expect(list).not.toContain(href(image.id)); expect(list).toContain(href(file.id));
  });
  // (Owner, Nov 5, §254; was PrevSetFolds' "Sent" version) (§263, final) An earlier set's sent answer is in its Terms history entry, its file inline (SentAnswer).
  it("previous sent sets keep their file inline and a current set does not hide an unplaced file", () => {
    const change = { at: "2026-11-05T10:00:00.000Z", then: [{ question: "What happened?", required: true, sent: { answer: items[0].answer, adds: [] }, draft: null }], now: [{ question: "What now?", required: true }] };
    const html = render(h(React.Fragment, null, h(QuestionsChangedEntry, { id: "past", change, files: uploads.map((f) => ({ ...f, uploadedAt: new Date() })) }), h(AttachmentList, { items: uploads, inlineText: ["The new answer"] })));
    expect(html).toContain("What happened?");
    expect(html).toContain(`<img src="${href(image.id)}"`);
    expect(html.slice(html.lastIndexOf('<ul'))).toContain(href(image.id));
  });
  it("the developer's unpaid and paid views, and the tester's sent view, pass their actual rendered answers to the list", async () => {
    const f = await setup(), j = await joined(f.testId);
    const sub = await db.submission.create({ data: { contractId: j.sessionId, kind: "written", agreedCents: 1000, answers: items, notes: "", payBy: new Date(Date.now() + 7 * 86400000) } });
    // (Owner, Nov 5, §263) The answers lists show the tester's current questions only: the contract asks "What happened?".
    await db.contract.update({ where: { id: j.sessionId }, data: { questions: ["[required] What happened?"] } });
    for (const upload of uploads) await db.recording.create({ data: { ...upload, contractId: j.sessionId, submissionId: sub.id, storageKey: randomUUID(), part: "written", uploadedAt: new Date() } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } });
    const { default: TestPage } = await import("@/app/app/tests/[id]/page");
    const unpaid = render(await TestPage({ params: Promise.resolve({ id: f.testId }), searchParams: Promise.resolve({}) }));
    // Unpaid: in Needs you and in the Testers list, its image inline in each, and never listed again.
    expect(unpaid.split('<details id="by-question"')[0].match(/<img [^>]*alt="screen.png"/g)).toHaveLength(2);
    expect(unpaid).toContain(href(file.id));
    await db.review.create({ data: { contractId: j.sessionId, submissionId: sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID() } });
    await db.payment.create({ data: { kind: "review", contractId: j.sessionId, submissionId: sub.id, developerId: f.dev.user.id, testerId: j.tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged" } });
    const paid = render(await TestPage({ params: Promise.resolve({ id: f.testId }), searchParams: Promise.resolve({}) }));
    expect(paid.split('<details id="by-question"')[0].match(/<img [^>]*alt="screen.png"/g)).toHaveLength(1);
    await db.contract.update({ where: { id: j.sessionId }, data: { status: "ended", endKind: "closed", endedAt: new Date() } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const sent = render(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) }));
    expect(sent).toContain(`<img src="${href(image.id)}"`);
    for (const html of [unpaid, paid, sent]) {
      const lists = html.match(/<ul[^>]*data-attachments=""[\s\S]*?<\/ul>/g) ?? [];
      expect(lists.length).toBeGreaterThan(0);
      for (const list of lists) { expect(list).not.toContain(href(image.id)); expect(list).toContain(href(file.id)); }
    }
    expect(sent).toContain(href(file.id));
  });

});
