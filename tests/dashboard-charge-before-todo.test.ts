import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
it("tester Charge decisions appear before To do and retain the existing notification anchor",()=>{
 const page=readFileSync("src/app/app/page.tsx","utf8");
 const charge=page.indexOf('id="charge-or-cancel"'),todo=page.indexOf('id="to-do"');
 expect(charge).toBeGreaterThan(0);expect(charge).toBeLessThan(todo);
 expect(page.match(/id="charge-or-cancel"/g)).toHaveLength(1);
});
