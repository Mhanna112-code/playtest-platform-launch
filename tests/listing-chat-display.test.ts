import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
it("join listing keeps timing and capacity immediately below Listing without duplicate payment marketing",()=>{
 const page=readFileSync("src/app/app/find/[id]/page.tsx","utf8");
 expect(page).toContain('data-listing-facts=""');
 expect(page).not.toContain('What you get:');
 expect(page).not.toContain('Locked in when you join');
 expect(page.indexOf('data-listing-facts')).toBeLessThan(page.indexOf('id="invitation"'));
});
it("session chat caps the visible badge while retaining the unread total for accessibility",()=>{
 const page=readFileSync("src/app/app/sessions/[id]/page.tsx","utf8");
 expect(page).toMatch(/Math\.min\(unread,\s*9\)/);
 expect(page).toMatch(/aria-label=.*unread/);
});
