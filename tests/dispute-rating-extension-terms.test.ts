import {expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {db} from "@/lib/db";
import {joined,setup} from "./fixtures";
import {testerRatingClosesAt,closeOutOf,pieceCloseOut,disputesClosed} from "@/lib/server/closeOut";
import {testerRateState,ratingReminders} from "@/lib/server/ratings";
import {DEADLINE_MOVEMENT_TERMS,PAYMENT_RULES} from "@/lib/termsOfUse";
const DAY=86400000;
async function sample(daysAgo=30){
 const s=await setup();const j=await joined(s.testId,"Dispute rating tester","they");const base=new Date(Date.now()-daysAgo*DAY);
 await db.test.update({where:{id:s.testId},data:{openUntil:base}});
 await db.contract.update({where:{id:j.sessionId},data:{dueAt:base,ratePromptedAt:new Date(base.getTime()+DAY)}});
 const sub=await db.submission.create({data:{contractId:j.sessionId,kind:"written",answers:[],agreedCents:1000,sentAt:new Date(base.getTime()-8*DAY),payBy:new Date(base.getTime()-DAY)}});
 await db.review.create({data:{contractId:j.sessionId,submissionId:sub.id,amountCents:400,agreedCents:1000,payKey:`sample-${sub.id}`,reason:"Partial sample payment"}});
 return {...s,...j,sub,base,at:(n:number)=>new Date(base.getTime()+n*DAY)};
}
it("a dispute pending past the original rating end preserves remaining time after the decision",async()=>{
 const s=await sample();
 const dispute=await db.dispute.create({data:{contractId:s.sessionId,submissionId:s.sub.id,testerId:s.tester.user.id,reason:"Sample dispute awaiting the team",createdAt:s.at(10)}});
 expect((await testerRatingClosesAt(s.sessionId,s.at(21)))?.getTime()).toBe(s.at(25).getTime());
 expect((await testerRateState(s.sessionId,s.at(21))).kind).toBe("disabled");
 await db.dispute.update({where:{id:dispute.id},data:{status:"decided",decidedAt:s.at(20),decidedCents:500}});
 expect((await testerRatingClosesAt(s.sessionId,s.at(23)))?.getTime()).toBe(s.at(24).getTime());
 expect((await testerRateState(s.sessionId,s.at(23))).kind).toBe("open");
 expect((await testerRateState(s.sessionId,s.at(24))).kind).toBe("closed");
 expect((await closeOutOf(s.testId,s.at(23)))?.getTime()).toBe(s.at(14).getTime());
 expect((await pieceCloseOut({submissionId:s.sub.id},"tester",s.at(23)))?.getTime()).toBe(s.at(14).getTime());
 await ratingReminders(s.at(23));
 const reminder=await db.notification.findFirstOrThrow({where:{userId:s.tester.user.id,text:{startsWith:"Reminder: rate "}}});
 expect(reminder.mustEmail).toBe(true);expect(reminder.text).toContain("rating closes on");
});
it("overlapping disputes count once and a call's dispute can be closed while extended rating remains open",async()=>{
 const s=await sample();
 await db.dispute.create({data:{contractId:s.sessionId,submissionId:s.sub.id,testerId:s.tester.user.id,reason:"First dispute",createdAt:s.at(10),status:"decided",decidedAt:s.at(20),decidedCents:500}});
 const slot=await db.callSlot.create({data:{testId:s.testId,startsAt:s.at(-2),minutes:10,allowedTesterIds:[],status:"booked"}});
 const call=await db.call.create({data:{contractId:s.sessionId,slotId:slot.id,startsAt:s.at(-2),minutes:10,rateCents:1000,measuredMinutes:10,measuredAt:s.at(-1),payBy:s.at(-1)}});
 await db.review.create({data:{contractId:s.sessionId,callId:call.id,amountCents:100,agreedCents:167,payKey:`call-${call.id}`,reason:"Call sample payment"}});
 await db.dispute.create({data:{contractId:s.sessionId,callId:call.id,testerId:s.tester.user.id,reason:"Second dispute",createdAt:s.at(12),status:"decided",decidedAt:s.at(22),decidedCents:150}});
 expect((await testerRatingClosesAt(s.sessionId,s.at(23)))?.getTime()).toBe(s.at(26).getTime());
 expect((await testerRateState(s.sessionId,s.at(23))).kind).toBe("open");
 expect((await disputesClosed(s.sessionId,[{callId:call.id}],s.at(23))).has(call.id)).toBe(true);
});
it("Terms explain Charge before edit rules, name buttons and remove the version-change panel",()=>{
 const page=readFileSync("src/app/terms/page.tsx","utf8");
 expect(page.indexOf('heading === "Unreviewed work: Charge or Let it go"')).toBeLessThan(page.indexOf('heading: "Editing a test: Switch or Keep"'));
 expect(page).not.toContain("What changed in version");
 expect(PAYMENT_RULES.find(r=>r.heading.startsWith("Unreviewed"))?.text).toContain("two buttons");
 expect(PAYMENT_RULES.map(r=>r.text).join(" ")).not.toContain("A Charge over $200 needs a tick");
 expect(PAYMENT_RULES.map(r=>r.text).join(" ")).not.toContain("only their own Pay settles it");
 expect(DEADLINE_MOVEMENT_TERMS).toContain("overlapping disputes or pauses counted once");
});

it("a very late team decision still restores remaining rating time and its final reminder",async()=>{
 const s=await sample(500);
 await db.dispute.create({data:{contractId:s.sessionId,submissionId:s.sub.id,testerId:s.tester.user.id,reason:"Long-running sample dispute",createdAt:s.at(10),status:"decided",decidedAt:s.at(498),decidedCents:500}});
 expect((await testerRatingClosesAt(s.sessionId,s.at(500)))?.getTime()).toBe(s.at(502).getTime());
 expect((await testerRateState(s.sessionId,s.at(500))).kind).toBe("open");
 await ratingReminders(s.at(500));
 expect((await db.notification.findFirstOrThrow({where:{userId:s.tester.user.id,text:{startsWith:"Reminder: rate "}}})).mustEmail).toBe(true);
});
