import {randomUUID} from "node:crypto";
import {expect,it} from "vitest";
import {limitedTesterSession} from "@/lib/limitedTesterSession";
import {db} from "@/lib/db";
import {GET as pulse} from "@/app/api/pulse/route";
import {POST as review} from "@/app/api/review/route";
import {json,req,makeUser} from "./helpers";
import {setup,joined,sact,seen} from "./fixtures";
it("limited session access requires suspension and ownership",()=>{
 expect(limitedTesterSession({id:"a",testerSuspendedAt:new Date()},{testerId:"a"})).toBe(true);
 expect(limitedTesterSession({id:"a",testerSuspendedAt:null},{testerId:"a"})).toBe(false);
 expect(limitedTesterSession({id:"a",testerSuspendedAt:new Date()},{testerId:"b"})).toBe(false);
});
it.each(["left","blocked","early","stopped","suspended"])("suspended tester can dispute old %s work, but cannot Charge, Rate, send or chat",async endKind=>{
 const s=await setup();const j=await joined(s.testId);
 await sact(j.sessionId,"written",j.tester.cookie,{answers:["Detailed feedback on the first question.","Detailed feedback on the second question."],confirmed:true,seenAt:seen()});
 const sub=await db.submission.findFirstOrThrow({where:{contractId:j.sessionId}});
 const paid=await review(req("/api/review",{cookie:s.dev.cookie,body:{kind:"submission",id:sub.id,amount:"4.00",tickedCents:400,reason:"Partial sample payment",payKey:randomUUID(),confirmed:true,seenAt:seen()}})).then(json);
 expect(paid.status).toBe(200);
 await db.contract.update({where:{id:j.sessionId},data:{status:"left",endKind,endedAt:new Date()}});
 await db.user.update({where:{id:j.tester.user.id},data:{testerSuspendedAt:new Date()}});
 const refresh=await pulse(req(`/api/pulse?session=${j.sessionId}`,{cookie:j.tester.cookie})).then(json);
 expect(refresh.status).toBe(200);expect(refresh.body.restricted).toBe(false);
 const dispute=await sact(j.sessionId,"dispute",j.tester.cookie,{kind:"submission",id:sub.id,reason:"The sample payment should be higher.",confirmed:true,seenAt:seen(),boxAt:seen()});
 expect(dispute.status,JSON.stringify(dispute.body)).toBe(200);
 for(const action of ["choose","rate","written","message"]){const result=await sact(j.sessionId,action,j.tester.cookie,{});expect(result.status).toBe(action==="choose"||action==="rate"?409:403);}
 const other=await makeUser({tester:true});await db.user.update({where:{id:other.user.id},data:{testerSuspendedAt:new Date()}});
 expect((await sact(j.sessionId,"dispute",other.cookie,{kind:"submission",id:sub.id,reason:"Cannot dispute someone else's work."})).status).not.toBe(200);
});
