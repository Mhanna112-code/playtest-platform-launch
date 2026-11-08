import {expect,it} from "vitest";
import {freeBoxCheck} from "@/app/app/tests/KeyBoxes";
it("manually typing a previously assigned key shows reuse without putting it In use",()=>{
 const data={free:[],inUse:[],previous:[{value:"A",tester:"Sample Tester"}],open:1,uses:true};
 const check=freeBoxCheck("A",[],data);
 expect(check.errors).toEqual([]);
 expect(check.warnings).toEqual(["A: reused, previously given to Sample Tester."]);
 expect(freeBoxCheck("NEW",[],data).warnings).toEqual([]);
});
