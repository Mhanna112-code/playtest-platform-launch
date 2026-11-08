import {expect,it} from "vitest";
import {keyAdditionsByEdit} from "@/lib/keys";
import {freeBoxCheck} from "@/app/app/tests/KeyBoxes";
it("automatically returned keys do not produce another-tab Added notices",()=>{
 expect(keyAdditionsByEdit(["A"],["A"])).toEqual([]);
 expect(keyAdditionsByEdit(["A","NEW"],["A"])).toEqual(["NEW"]);
 expect(keyAdditionsByEdit(["NEW"],[])).toEqual(["NEW"]);
});
it("a returned key can move to Free without losing a local addition or deletion",()=>{
 const mine=freeBoxCheck("C\nDRAFT",["B","C"],null);
 const nowFree=["A","B","C"];
 const merged=[...nowFree.filter(v=>!mine.removed.includes(v)),...mine.added.filter(v=>!nowFree.includes(v))];
 expect(merged).toEqual(["A","C","DRAFT"]);
 expect(keyAdditionsByEdit(nowFree.filter(v=>!["B","C"].includes(v)),["A"])).toEqual([]);
});
