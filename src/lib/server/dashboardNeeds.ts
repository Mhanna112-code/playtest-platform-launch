import { db } from "@/lib/db";
import { bankWaitingOnTest } from "./confirm";
import { devRateStates } from "./ratings";
import { pendingForDeveloper } from "./excerpts";
import { answerable } from "./joining";
import { closedOut, pieceCloseOut } from "./closeOut";
import { teamPausedNow } from "@/lib/restricted";
import { testerPayable } from "@/lib/rules";
import { callMinutesOf } from "@/lib/callMeasure";
import { updateWaiting } from "@/lib/moneyLines";
import { updateRoomLeft } from "./paidUpdates";
/** The actionable contents of each developer test's Needs you, including restricted views. */
export async function developerNeedsRows(developerId:string,testIds:string[],now=new Date()) {
 const dev=await db.user.findUniqueOrThrow({where:{id:developerId}});
 const tests=await db.test.findMany({where:{id:{in:testIds},developerId},include:{contracts:{include:{tester:true,submissions:{include:{review:true,dispute:true}},calls:{include:{review:true,dispute:true}}}}}});
 const rates=await devRateStates(tests.flatMap(t=>t.contracts.map(c=>c.id)),now);
 const excerpts=await pendingForDeveloper(developerId);
 const applications=await answerable(await db.application.findMany({where:{testId:{in:testIds},status:"pending"}}));
 const requests=await db.callRequest.findMany({where:{testId:{in:testIds},status:"pending",fromSide:"tester",startsAt:{gt:now}}});
 return Promise.all(tests.map(async t=>{
  const restricted=!!(dev.holdStartedAt||dev.devSuspendedAt)||teamPausedNow(t);
  const banks=await bankWaitingOnTest(developerId,t.id);
  const confirming=await db.payment.findMany({where:{contractId:{in:t.contracts.map(c=>c.id)},kind:{in:["review","call"]},status:"needs_action"},select:{submissionId:true,callId:true}});
  let count=banks.length+excerpts.filter(x=>x.testId===t.id).length;
  for(const c of t.contracts){
   count += [...c.submissions,...c.calls].filter(x=>x.dispute?.status==="open"&&!x.dispute.devSide).length;
   // (Owner, Nov 9, §368) A team pause or a suspension (not a hold) keeps the parts to pay in the restricted view: paying goes on.
   if(restricted){count+=c.calls.filter(x=>x.status==="booked"&&x.startsAt>now).length;if(dev.holdStartedAt)continue;}
   else if(rates.get(c.id)?.kind==="open")count++;
   if(!testerPayable(c.tester))continue;
   for(const x of c.submissions){
    if(!x.review&&(confirming.some(p=>p.submissionId===x.id)||!closedOut(await pieceCloseOut({submissionId:x.id},now),now)))count++;
    if(updateWaiting(x)&&await updateRoomLeft(x.id))count++; // (Owner, Nov 11, §378) Pay more open on this piece's own date (paidUpdateRoom)
   }
   for(const x of c.calls)if(x.status==="booked"&&callMinutesOf(x)!=null&&!x.review&&(confirming.some(p=>p.callId===x.id)||!closedOut(await pieceCloseOut({callId:x.id},now),now)))count++;
  }
  if(!restricted){count+=applications.filter(a=>a.testId===t.id).length;count+=requests.filter(r=>r.testId===t.id&&t.contracts.some(c=>c.id===r.contractId)).length;}
  return {id:t.id,title:t.title,n:count,at:t.updatedAt};
 }));
}
