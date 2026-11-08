import {expect,it} from "vitest";
import {db} from "@/lib/db";
import {keyBoxes,planKeyChange,applyKeyChange} from "@/lib/server/accessKeys";
import {finishWorkIfDue} from "@/lib/server/workWindow";
import {joined,setup,sact,seen} from "./fixtures";
it("manual re-add restores an unassigned key to Free with its previous tester tag, even after deletion",async()=>{
 const s=await setup({spots:1,accessKeys:"OLD-KEY\nSPARE-KEY"});const j=await joined(s.testId,"Previous Tester","they");
 await sact(j.sessionId,"leave",j.tester.cookie,{seenAt:seen(),confirmed:true});
 const before=await keyBoxes(s.testId);expect(before.inUse).toEqual([]);expect(before.free.map(k=>k.value)).toEqual(["SPARE-KEY"]);
 expect(before.previous).toContainEqual({value:"OLD-KEY",tester:"Previous Tester"});
 for(const deleted of [false,true]){
  if(deleted)await db.accessKey.deleteMany({where:{testId:s.testId,value:"OLD-KEY"}});
  const plan=await planKeyChange(db,s.testId,["OLD-KEY"],[],1);
  expect(plan.errors).toEqual([]);expect(plan.warnings).toEqual(["OLD-KEY: reused, previously given to Previous Tester."]);
  await applyKeyChange(db,s.testId,plan.toAdd,plan.removable,plan.toReuse);
  expect((await keyBoxes(s.testId)).free.find(k=>k.value==="OLD-KEY")?.reused).toEqual({from:"Previous Tester"});
 }
});
it("normal work closure unassigns immediately without returning the assigned key to Free",async()=>{
 const s=await setup({spots:1,accessKeys:"CLOSE-KEY"});const j=await joined(s.testId);
 const past=new Date(Date.now()-86400000);
 await db.test.update({where:{id:s.testId},data:{openUntil:past}});await db.contract.update({where:{id:j.sessionId},data:{dueAt:past}});
 expect(await finishWorkIfDue(s.testId)).toBe(true);
 expect(await db.accessKey.findFirst({where:{testId:s.testId,value:"CLOSE-KEY"}})).toMatchObject({status:"unassigned",contractId:null});
 expect((await keyBoxes(s.testId)).free).toEqual([]);
});

it("rating ends participation and unassigns its key immediately",async()=>{
 const s=await setup({spots:1,accessKeys:"RATE-KEY"});const j=await joined(s.testId,"Rating Tester","they");
 await sact(j.sessionId,"written",j.tester.cookie,{answers:["Sample answer to the first question.","Sample answer to the second question."],seenAt:seen(),confirmed:true});
 const sub=await db.submission.findFirstOrThrow({where:{contractId:j.sessionId}});
 await db.review.create({data:{submissionId:sub.id,contractId:j.sessionId,amountCents:500,agreedCents:1000,payKey:`rate-key-${sub.id}`,reason:"Sample reviewed work"}});
 const rated=await sact(j.sessionId,"rate",j.tester.cookie,{stars:5,comment:"Clear instructions and a useful sample test.",seenAt:seen(),boxAt:seen(),confirmed:true});
 expect(rated.status,JSON.stringify(rated.body)).toBe(200);
 expect(await db.accessKey.findFirst({where:{testId:s.testId,value:"RATE-KEY"}})).toMatchObject({status:"unassigned",contractId:null});
});
