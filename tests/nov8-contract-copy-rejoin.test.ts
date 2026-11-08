import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {PAY_RULES_TICK} from "@/lib/rules";
import {EDIT_TEST_TERMS} from "@/lib/termsOfUse";
import {SENT_WORK_PRICE_EXPLANATION} from "@/lib/answerTerms";
import {db} from "@/lib/db";
import {joined,setup} from "./fixtures";
import {testV} from "@/lib/server/pulseV";
it("keeps the full addition rule in Terms and acknowledges saved old listing prices",()=>{
 expect(EDIT_TEST_TERMS).toContain(SENT_WORK_PRICE_EXPLANATION);
 expect(PAY_RULES_TICK).toContain("up to the listing price (or the old listing price for past work sent)");
 const form=readFileSync("src/app/app/tests/TestForm.tsx","utf8");
 expect(form).not.toContain("SENT_WORK_PRICE_EXPLANATION");
 const session=readFileSync("src/app/app/sessions/[id]/page.tsx","utf8");
 expect(session).not.toContain("Your contract stays as it is:");
 expect(session).toContain('key={`${c.id}:${c.status}:${c.endedAt?.getTime() ?? 0}`}');
});
it("rejoining changes the left session's refresh fingerprint even with no listing edit",async()=>{
 const s=await setup();const j=await joined(s.testId);
 await db.contract.update({where:{id:j.sessionId},data:{status:"left",endedAt:new Date(),endKind:"left"}});
 const left=await testV(j.tester.user.id,s.testId,j.sessionId);
 await db.contract.update({where:{id:j.sessionId},data:{status:"working",endedAt:null,endKind:""}});
 expect(await testV(j.tester.user.id,s.testId,j.sessionId)).not.toBe(left);
});
