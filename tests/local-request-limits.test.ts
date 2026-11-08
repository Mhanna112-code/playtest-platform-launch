import { expect,it,vi } from "vitest";
import { makeUser } from "./helpers";
import { db } from "@/lib/db";
import { setup,joined } from "./fixtures";
it("local no-limits bypasses invite and application quotas, but a Vercel environment cannot enable it",async()=>{
 const s=await setup(),j=await joined(s.testId);const fresh=await makeUser({tester:true});const data={note:"",listing:{},kind:"apply",ndaAcceptedAt:null};
 vi.stubEnv("NEXT_PUBLIC_TESTING_NO_LIMITS","1");vi.stubEnv("VERCEL","");vi.resetModules();
 const {saveJoinRequest}=await import("@/lib/server/joining");
 try{
  for(let i=0;i<3;i++){await saveJoinRequest(j.tester.user.id,s.testId,data,"Panel Tester applied to join");await db.application.updateMany({where:{testId:s.testId,testerId:j.tester.user.id},data:{status:"withdrawn"}});}
  await db.invite.createMany({data:[...Array.from({length:100},(_,i)=>({testId:s.testId,testerId:`seed-${s.testId}-${i}`,status:"cancelled"})),...Array.from({length:3},()=>({testId:s.testId,testerId:fresh.user.id,status:"cancelled"}))]});
  const {inviteTesters}=await import("@/lib/server/invites");
  await inviteTesters(s.dev.user,s.testId,{testerIds:[fresh.user.id],confirmed:true,seenAt:new Date().toISOString()});
  expect(await db.invite.count({where:{testId:s.testId,testerId:fresh.user.id,status:"sent"}})).toBe(1);
  vi.stubEnv("VERCEL","1");vi.resetModules();expect((await import("@/lib/testingLimits")).TESTING_NO_LIMITS).toBe(false);
 }finally{vi.unstubAllEnvs();vi.resetModules();}
});

