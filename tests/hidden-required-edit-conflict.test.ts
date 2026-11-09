import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { toApi, toForm } from "@/app/app/tests/TestForm";
import { asListing, editNews } from "@/lib/server/tests";
import { act, seen, setup } from "./fixtures";

it("ticking written answers, changing questions, then unticking saves without a fabricated Required conflict", async () => {
  const { dev, testId } = await setup({ writtenCents: null, writtenRequired: true });
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const form = toForm(asListing(t));
  const base = toApi(form);
  const brieflyOn = { ...form, written: true, writtenPrice: "10.00" };
  const after = { ...brieflyOn, written: false, questions: "What would you improve in the navigation?" };
  const has = toApi(after);
  const fields = { writtenCents: has.writtenCents, writtenRequired: has.writtenRequired, questions: has.questions };
  expect((await editNews(db, testId, { base, has, fields }, asListing(t)))?.fields).toEqual([]);
  const result = await act(testId, "edit", dev.cookie, { version: t.version, fields, base, has, seenAt: seen(), confirmed: true });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const saved = await db.test.findUniqueOrThrow({ where: { id: testId } });
  expect(saved.writtenCents).toBeNull();
  // (Owner, Nov 9, §349, audit E5 / E5b; replaces f35e7b90's saving of them) The unticked part's hidden fields are kept as they were: neither saved nor announced.
  expect(saved.writtenRequired).toBe(true);
  expect(saved.questions).toEqual(t.questions);
});

it("round-trips all hidden Required flags without changing their saved values", async () => {
  const { testId } = await setup({ writtenCents: null, recordingCents: null, liveRateCents: "10.00" });
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const listing = { ...asListing(t), writtenCents: null, recordingCents: null, liveRateCents: null, writtenRequired: true, recordingRequired: true, liveRequired: true };
  expect(toApi(toForm(listing))).toMatchObject({ writtenRequired: true, recordingRequired: true, liveRequired: true });
});

it("still detects a genuine Required change saved elsewhere", async () => {
  const { testId } = await setup({ writtenRequired: false });
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const base = toApi(toForm(asListing(t)));
  const current = { ...asListing(t), writtenRequired: true };
  expect((await editNews(db, testId, { base, has: base, fields: { writtenRequired: false } }, current))?.fields).toEqual(["writtenRequired"]);
});
