import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PRICE_LIMITS, NO_LISTING_WORK_CAP_CENTS, pieceMaxCents, pieceCapCents, chargeAmount } from "@/lib/rules";
import { CALLS_TOTAL_CENTS } from "@/lib/callMeasure";
import { db } from "@/lib/db";
import { POST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { act, joined, seen, setup } from "./fixtures";

it("caps listed and unlisted pieces and the shared calls allowance at $500", () => {
 expect(PRICE_LIMITS.partMax).toBe(50000);
 expect(NO_LISTING_WORK_CAP_CENTS).toBe(50000);
 expect(pieceMaxCents("submission")).toBe(50000);
 expect(pieceCapCents(null, pieceMaxCents("submission"))).toBe(50000);
 expect(CALLS_TOTAL_CENTS).toBe(50000);
 expect(chargeAmount(100000,0)).toBe(50000);
});
it.each(["written", "recording"])("%s payments and Pay more share the 500 USD ceiling", async kind => {
 const s=await setup(); const j=await joined(s.testId,"Cap Tester","they");
 const sub=await db.submission.create({data:{contractId:j.sessionId,kind,agreedCents:null}});
 const pay=(amount:string,cents:number)=>POST(req("/api/review",{cookie:s.dev.cookie,body:{kind:"submission",id:sub.id,amount,tickedCents:cents,over200:true,payKey:randomUUID(),seenAt:seen(),confirmed:true}})).then(json);
 expect((await pay("500.01",50001)).status).toBe(400);
 expect((await pay("400.00",40000)).status).toBe(200);
 const extra=(amount:string,cents:number)=>act(s.testId,"pay-extra",s.dev.cookie,{contractId:j.sessionId,submissionId:sub.id,amount,tickedCents:cents,over200:true,seenAt:seen(),confirmed:true,payKey:randomUUID()});
 expect((await extra("100.01",10001)).status).toBe(400);
 expect((await extra("100.00",10000)).status).toBe(200);
 expect((await db.payment.aggregate({where:{submissionId:sub.id,status:{in:["charged","not_set_up"]}},_sum:{amountCents:true}}))._sum.amountCents).toBe(50000);
 expect((await extra("1.00",100)).body.error.message).toBe("Paid the most this piece can be paid ($500.00).");
});
