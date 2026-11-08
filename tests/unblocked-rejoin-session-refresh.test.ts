import {expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {db} from "@/lib/db";
import {canAskToRejoin} from "@/lib/rules";
import {POST as blockRoute} from "@/app/api/blocks/route";
import {GET as pulse} from "@/app/api/pulse/route";
import {json,req} from "./helpers";
import {act,joined,setup,seen,sact} from "./fixtures";
const block=(cookie:string,userId:string,action?:string)=>blockRoute(req("/api/blocks",{cookie,body:{userId,action}})).then(json);
it("a past block does not permanently prevent asking, including a deadline that passed",()=>{
 const ended={status:"ended",endKind:"blocked",endedAt:new Date(),dueAt:new Date(Date.now()-86400000)};
 expect(canAskToRejoin(ended,false)).toBe(true);
 expect(canAskToRejoin(ended,true)).toBe(false);
 for(const endKind of ["stopped","closed","rated"])expect(canAskToRejoin({...ended,endKind},false)).toBe(false);
});
it.each(["tester","developer"])("%s block ends participation; asking waits for both blocks to clear; rejoin restores the same session and poll state",async side=>{
 const s=await setup();const j=await joined(s.testId,"Rejoin sample","they");
 expect((await block(side==="tester"?j.tester.cookie:s.dev.cookie,side==="tester"?s.dev.user.id:j.tester.user.id)).status).toBe(200);
 expect(await db.contract.findUnique({where:{id:j.sessionId},select:{status:true,endKind:true}})).toEqual({status:"ended",endKind:"blocked"});
 const check=()=>pulse(req(`/api/pulse?session=${j.sessionId}`,{cookie:j.tester.cookie})).then(json);
 expect((await check()).body.sessionActive).toBe(false);
 const ask=()=>act(s.testId,"rejoin-ask",j.tester.cookie,{listingVersion:1,seenAt:seen(),confirmed:true});
 expect((await ask()).status).toBe(409);
 // A reciprocal block remains effective when only one side unblocks.
 expect((await block(side==="tester"?s.dev.cookie:j.tester.cookie,side==="tester"?j.tester.user.id:s.dev.user.id)).status).toBe(200);
 await block(side==="tester"?j.tester.cookie:s.dev.cookie,side==="tester"?s.dev.user.id:j.tester.user.id,"unblock");
 expect((await ask()).status).toBe(409);
 await block(side==="tester"?s.dev.cookie:j.tester.cookie,side==="tester"?j.tester.user.id:s.dev.user.id,"unblock");
 const asked=await ask();expect(asked.status,JSON.stringify(asked.body)).toBe(200);
 const app=await db.application.findUniqueOrThrow({where:{testId_testerId:{testId:s.testId,testerId:j.tester.user.id}}});
 const accepted=await act(s.testId,"application",s.dev.cookie,{applicationId:app.id,choice:"accept",seenAt:seen(),confirmed:true});
 expect(accepted.status,JSON.stringify(accepted.body)).toBe(200);
 expect((await check()).body.sessionActive).toBe(true);
 expect((await sact(j.sessionId,"leave",j.tester.cookie,{seenAt:seen(),confirmed:true})).status).toBe(200);
 expect((await check()).body.sessionActive).toBe(false);
 expect((await ask()).status).toBe(200);
 const again=await act(s.testId,"application",s.dev.cookie,{applicationId:app.id,action:"accept",seenAt:seen(),confirmed:true});
 expect(again.status,JSON.stringify(again.body)).toBe(200);
 expect((await check()).body.sessionActive).toBe(true);
 expect(await db.contract.count({where:{testId:s.testId,testerId:j.tester.user.id}})).toBe(1);
});
it("the old session watches rejoin explicitly, checks on focus and does not offer a known-invalid ordinary Join",()=>{
 const refresh=readFileSync("src/components/AutoRefresh.tsx","utf8");
 expect(refresh).toContain('shownActive.current === false && activeNow === true');
 expect(refresh).toContain('window.addEventListener("focus", liveBeat)');
 expect(readFileSync("src/app/app/find/[id]/page.tsx","utf8")).toContain('!!mine && !canRejoin && !invite');
});
