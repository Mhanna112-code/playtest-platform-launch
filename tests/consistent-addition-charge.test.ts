import { expect, it } from "vitest";
import { additionTerms } from "@/lib/server/submissionAdditions";
const now = new Date("2026-11-07T12:00:00Z");
const day = 86400000;
const future = { dueAt: new Date(+now + day) };
const old = { late: false, review: null, payBy: new Date(+now + day), choiceOfferedAt: null };
it.each([1000, 3000, 0, null])("before deadline all additions adopt current agreed price %s", price => {
  expect(additionTerms(old, future, price, now)).toMatchObject({agreedCents:price,late:false,choiceBy:null,stintDueAt:null});
});
it("after deadline additions preserve on-time status, price and all Charge dates", () => {
  expect(additionTerms(old, {dueAt:new Date(+now-day)}, null, now)).toEqual({late:false});
});
it("already opened Charge stays frozen even after deadline extension", () => {
  expect(additionTerms({...old,choiceOfferedAt:new Date(+now-day)},future,1000,now)).toEqual({late:false});
});
it("Charge eligibility freezes even before daily job stamps its opening", () => {
  expect(additionTerms({...old,payBy:new Date(+now-day)}, {dueAt:new Date(+now-day)},3000,now)).toEqual({late:false});
});
it("paid or charged pieces never adopt a new price or Charge window", () => {
  expect(additionTerms({...old,review:{}},future,3000,now)).toEqual({late:false,paidUpdateAt:now});
});
it("late originals remain late and fresh late work is late", () => {
  expect(additionTerms({...old,late:true},future,3000,now).late).toBe(true);
  expect(additionTerms(null,{dueAt:new Date(+now-day)},3000,now).late).toBe(true);
});
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { addTo, joined, sact, seen, setup } from "./fixtures";

it.each(["written", "written-add", "recording"])("%s addition adopts price before deadline and preserves Charge after it", async kind => {
  const { testId } = await setup({recordingCents:"10.00"});
  const j = await joined(testId, "Addition Tester", "they");
  const subKind = kind === "recording" ? "recording" : "written";
  const original = await db.submission.create({data:{contractId:j.sessionId,kind:subKind,agreedCents:2000,payBy:new Date(Date.now()+day),answers:[{question:"What did you like?",answer:"original",required:false},{question:"Where did you get stuck?",answer:"original",required:false}]}});
  const send = async () => {
    if(kind === "recording") await db.recording.create({data:{contractId:j.sessionId,storageKey:randomUUID(),filename:"run.mp4",sizeBytes:10,contentType:"video/mp4",uploadedAt:new Date(),part:"recording"}});
    if(kind === "written") await db.contract.update({where:{id:j.sessionId},data:{questions:[`new ${randomUUID()}`]}});
    const body={seenAt:seen(),confirmed:true,text:"Additional detailed feedback. ".repeat(3),answers:["fresh"]};
    const r=kind === "written-add" ? await addTo(j.sessionId,j.tester.cookie,body) : await sact(j.sessionId,kind === "recording" ? "recording-send" : "written",j.tester.cookie,body);
    expect(r.status,JSON.stringify(r.body)).toBe(200);
  };
  await send();
  expect((await db.submission.findUniqueOrThrow({where:{id:original.id}})).agreedCents).toBe(1000);
  const past=new Date(Date.now()-day),by=new Date(Date.now()+7*day);
  await db.contract.update({where:{id:j.sessionId},data:{dueAt:past,writtenCents:null,recordingCents:null}});
  await db.submission.update({where:{id:original.id},data:{payBy:past,choiceOfferedAt:past,choiceBy:by}});
  await send();
  expect(await db.submission.findUniqueOrThrow({where:{id:original.id}})).toMatchObject({agreedCents:1000,late:false,payBy:past,choiceOfferedAt:past,choiceBy:by});
});
