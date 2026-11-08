import { expect,it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { asListing } from "@/lib/server/tests";
import { reportPerson,REPORT_NOTE_MIN } from "@/lib/server/reports";
import { saveJoinRequest } from "@/lib/server/joining";
import { act,joined,seen,setup } from "./fixtures";
import { makeUser } from "./helpers";
it("all previously five-character public minima are ten",()=>{
 expect([R.TITLE_MIN_CHARS,R.MATURE_WHY_MIN,R.WHY_MIN_CHARS,REPORT_NOTE_MIN]).toEqual([10,10,10,10]);
 for(const amount of [0,100]){expect(R.checkPay(amount,1000,"123456789",amount).ok).toBe(false);expect(R.checkPay(amount,1000,"1234567890",amount).ok).toBe(true);}
 expect(R.checkDevSide("123456789",false).ok).toBe(false);expect(R.checkDevSide("1234567890",false).ok).toBe(true);
});
it.each(["stop","end-early"])("%s accepts ten trimmed characters and refuses nine",async action=>{
 const s=await setup();const j=await joined(s.testId);
 const press=(reason:string)=>act(s.testId,action,s.dev.cookie,{contractId:j.sessionId,reason,seenAt:seen(),confirmed:true});
 expect((await press(" 123456789 ")).body.error.message).toBe(R.WHY_TOO_SHORT);
 expect((await press("1234567890")).status).toBe(200);
});
it("mature explanations and unchanged production title rule use the new boundary",async()=>{
 const s=await setup();const t=await db.test.findUniqueOrThrow({where:{id:s.testId}});const listing=asListing(t);
 expect(R.checkListing({...listing,mature:true,matureWhy:"123456789"})).toContain(R.MATURE_WHY_SHORT);
 expect(R.checkListing({...listing,mature:true,matureWhy:"1234567890"})).not.toContain(R.MATURE_WHY_SHORT);
});
it("a person report needs ten characters",async()=>{
 const a=await makeUser(),b=await makeUser();await expect(reportPerson(a.user,{userId:b.user.id,note:"123456789"})).rejects.toThrow("Say what happened");
 await reportPerson(a.user,{userId:b.user.id,note:"1234567890"});expect(await db.report.count({where:{reporterId:a.user.id,reportedId:b.user.id}})).toBe(1);
});
it("application/rejoin attempts share two per test per rolling day, including concurrent presses",async()=>{
 const s=await setup(),j=await joined(s.testId);const data={note:"",listing:{},kind:"apply",ndaAcceptedAt:null};
 const first=await saveJoinRequest(j.tester.user.id,s.testId,data,"Panel Tester applied to join");await db.application.update({where:{id:first.id},data:{status:"withdrawn"}});
 await saveJoinRequest(j.tester.user.id,s.testId,{...data,kind:"rejoin"},"Panel Tester asks to rejoin");await db.application.update({where:{id:first.id},data:{status:"withdrawn"}});
 await expect(saveJoinRequest(j.tester.user.id,s.testId,data,"Panel Tester applied to join")).rejects.toThrow("twice in 24 hours");
 await db.testEvent.updateMany({where:{testId:s.testId,kind:"applied"},data:{createdAt:new Date(Date.now()-25*3600000)}});
 const results=await Promise.allSettled([saveJoinRequest(j.tester.user.id,s.testId,data,"Panel Tester applied to join"),saveJoinRequest(j.tester.user.id,s.testId,data,"Panel Tester applied to join")]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
});
