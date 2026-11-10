import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as review } from "@/app/api/review/route";
import { json,req } from "./helpers";
import { act,bookCall,joined,sact,seen,setup } from "./fixtures";
import { testerRateState,devRateStates,ratingsToGive,testerRate,devRate,ratingReminders } from "@/lib/server/ratings";
import { developerNeedsRows } from "@/lib/server/dashboardNeeds";
import { testerEarned } from "@/lib/server/paymentLists";
import { dashboardV } from "@/lib/server/pageFreshness";
const pay=(cookie:string,id:string,amount="1.00",tickedCents=100)=>review(req("/api/review",{cookie,body:{kind:"submission",id,amount,tickedCents,reason:"Partial payment for this sample",seenAt:seen(),confirmed:true,payKey:randomUUID()}})).then(json);
async function work(){const s=await setup();const j=await joined(s.testId,"Panel Tester","they");await sact(j.sessionId,"written",j.tester.cookie,{answers:["sample feedback","sample feedback"],seenAt:seen(),confirmed:true});const sub=await db.submission.findUniqueOrThrow({where:{contractId_kind:{contractId:j.sessionId,kind:"written"}}});return {...s,...j,sub};}
it("Needs you retains a rating-only test and removes it once that final action is done",async()=>{
 const w=await work();expect((await developerNeedsRows(w.dev.user.id,[w.testId]))[0].n).toBe(1);
 expect((await pay(w.dev.cookie,w.sub.id)).status).toBe(200);
 expect((await developerNeedsRows(w.dev.user.id,[w.testId]))[0].n).toBe(0);
 const before=await dashboardV(w.dev.user);
 expect((await sact(w.sessionId,"rate",w.tester.cookie,{stars:4,seenAt:seen(),confirmed:true})).status).toBe(200);
 expect((await developerNeedsRows(w.dev.user.id,[w.testId]))[0].n).toBe(1);
 expect(await dashboardV(w.dev.user)).not.toBe(before);
 expect((await act(w.testId,"rate",w.dev.cookie,{contractId:w.sessionId,stars:4,seenAt:seen(),confirmed:true})).status).toBe(200);
 expect((await developerNeedsRows(w.dev.user.id,[w.testId]))[0].n).toBe(0);
});
it.each(["tester","developer"])("deleting the %s closes both rating actions, dashboard rows and future reminders",async side=>{
 const w=await work();await pay(w.dev.cookie,w.sub.id);
 expect((await testerRateState(w.sessionId)).kind).toBe("open");
 await db.user.update({where:{id:side==="tester"?w.tester.user.id:w.dev.user.id},data:{deletedAt:new Date()}});
 expect((await testerRateState(w.sessionId)).kind).toBe("hidden");
 expect((await ratingsToGive(w.tester.user,"tester")).some(x=>x.id===w.sessionId)).toBe(false);
 await expect(testerRate(w.tester.user,w.sessionId,{stars:4,seenAt:seen(),confirmed:true})).rejects.toThrow(/session has ended, so your Rate didn't go through|This test was stopped, so your Rate didn't go through/); // (§364 item 9)
 await db.rating.create({data:{testId:w.testId,contractId:w.sessionId,side:"tester",raterId:w.tester.user.id,rateeId:w.dev.user.id,stars:4}});
 expect((await devRateStates([w.sessionId])).get(w.sessionId)?.kind).toBe("hidden");
 expect((await ratingsToGive(w.dev.user,"developer")).some(x=>x.id===w.sessionId)).toBe(false);
 await expect(devRate(w.dev.user,w.testId,{contractId:w.sessionId,stars:4,seenAt:seen(),confirmed:true})).rejects.toThrow(/session has ended, so your Rate didn't go through|This test was stopped, so your Rate didn't go through/); // (§364 item 9)
 await db.contract.update({where:{id:w.sessionId},data:{ratePromptedAt:new Date(Date.now()-5*86400000)}});
 await ratingReminders();
 expect(await db.notification.count({where:{testId:w.testId,text:{startsWith:"Reminder: rate "}}})).toBe(0);
});
it.each(["written","recording"])("earnings link the %s part independently to its session payment summary",async kind=>{
 const w=await work();const sub=kind==="written"?w.sub:await db.submission.create({data:{contractId:w.sessionId,kind:"recording",agreedCents:null}});
 expect((await pay(w.dev.cookie,sub.id)).status).toBe(200);
 const earned=await testerEarned(w.tester.user.id);const p=earned.list.find(p=>p.submissionId===sub.id)!;const row=earned.rows.get(p.id)!;
 expect(row.links).toContainEqual({text:kind==="written"?"your written answers":"your recording",kind:"part",href:`/app/sessions/${w.sessionId}#payment-${sub.id}`});
 expect(row.links?.some(l=>l.kind==="person")).toBe(true);expect(row.links?.some(l=>l.kind==="test")).toBe(true);
});
import * as rateGates from "@/lib/server/testerGate";
import { closeOutOf } from "@/lib/server/closeOut";
import { vi } from "vitest";
it("a tester who left retains Rating until the test-wide 14-day close-out",async()=>{
 const w=await work();await pay(w.dev.cookie,w.sub.id);
 expect((await sact(w.sessionId,"leave",w.tester.cookie,{seenAt:seen(),confirmed:true})).status).toBe(200);
 const base=new Date(Date.now()-2*86400000);
 await db.test.update({where:{id:w.testId},data:{openUntil:base}});
 await db.contract.update({where:{id:w.sessionId},data:{dueAt:base}});
 const closes=await closeOutOf(w.testId);
 expect(closes?.getTime()).toBe(base.getTime()+14*86400000);
 expect((await testerRateState(w.sessionId,new Date(closes!.getTime()-1))).kind).toBe("open");
 expect((await testerRateState(w.sessionId,closes!)).kind).toBe("closed");
});
it("deletion landing after the rating gate is refused under the write lock",async()=>{
 const w=await work();await pay(w.dev.cookie,w.sub.id);
 const original=rateGates.testerGate;
 const spy=vi.spyOn(rateGates,"testerGate").mockImplementationOnce(async(...args)=>{
   const result=await original(...args);
   await db.user.update({where:{id:w.dev.user.id},data:{deletedAt:new Date()}});
   return result;
 });
 try {
  await expect(testerRate(w.tester.user,w.sessionId,{stars:4,seenAt:seen()})).rejects.toThrow("This test was stopped, so your Rate didn't go through."); // (§364 item 9)
  expect(spy).toHaveBeenCalledTimes(1);
  expect(await db.rating.count({where:{contractId:w.sessionId}})).toBe(0);
 } finally {spy.mockRestore();}
});

it("call earnings open that call's payment status rather than a different part",async()=>{
 const w=await work();const call=await bookCall(w.testId,w.dev.cookie,w.sessionId,w.tester.cookie);
 await db.call.update({where:{id:call.id},data:{startsAt:new Date(Date.now()-2*3600000),measuredMinutes:30,measuredAt:new Date()}});
 const r=await json(await review(req("/api/review",{cookie:w.dev.cookie,body:{kind:"call",id:call.id,amount:"1.00",tickedCents:100,reason:"Partial call payment",seenAt:seen(),confirmed:true,payKey:randomUUID()}})));
 expect(r.status,JSON.stringify(r.body)).toBe(200);
 const earned=await testerEarned(w.tester.user.id);const payment=earned.list.find(p=>p.callId===call.id)!;
 expect(earned.rows.get(payment.id)?.links).toContainEqual({text:"your live call",kind:"part",href:`/app/sessions/${w.sessionId}#payment-${call.id}`});
});
