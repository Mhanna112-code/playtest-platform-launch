const fs = require("fs");
const F = __dirname + "/parts/b20y.js";
let s = fs.readFileSync(F, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing " + a.slice(0, 60)); s = s.replace(a, () => b); };
rep(`      await waitPoll(A, "#part-written [data-dispute-none]");`,
`      // (The page's own 20-second refresh; on tonight's busy server it can take a while. Not there after 2.5 minutes: the page is reloaded and the caption says so.)
      const live15 = await waitPoll(A, "#part-written [data-dispute-none]", false, 150000);
      if (!live15) { await A.reload(); await A.waitForSelector("#part-written [data-dispute-none]"); }`);
rep(`“Extra $2.00”), the page's own refresh greys`, `“Extra $2.00”), \${live15 ? "the page's own refresh" : "the page (reloaded: tonight's busy server was slow)"} greys`);
// that caption is a plain string: make it a template
rep(`await shot(A, "b20-15-nothing-to-dispute", "§15 Nothing left to award | After Nora's Pay more of $2.00 (`, "await shot(A, \"b20-15-nothing-to-dispute\", `§15 Nothing left to award | After Nora's Pay more of $2.00 (");
rep(`so there's nothing to dispute.”", A.locator("#part-written [data-dispute-none]").locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]"));`, "so there's nothing to dispute.”`, A.locator(\"#part-written [data-dispute-none]\").locator(\"xpath=ancestor::div[contains(@class,'rounded-lg')][1]\"));");
rep(`      await waitLive(D, "[data-live-top]:has-text('rated you')", 45000);
      await waitPoll(D, "[data-rate-need]", false, 60000);`, `      await waitLive(D, "[data-live-top]:has-text('rated you')", 150000);
      const live24 = await waitPoll(D, "[data-rate-need]", false, 120000);
      if (!live24) console.log("   ! §24: Needs you's Rate row didn't come with the poll");`);
rep("await shot(D, \"b20-24-needs-rate\", `§24 Needs you | The same poll adds", "if (live24) await shot(D, \"b20-24-needs-rate\", `§24 Needs you | The same poll adds");
rep(`      await waitLive(L, "[data-live-top]:has-text('switched')", 60000);`, `      await waitLive(L, "[data-live-top]:has-text('switched')", 150000);`);
fs.writeFileSync(F, s);
console.log("ok");
