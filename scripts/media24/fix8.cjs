const fs = require("fs"); const F = __dirname + "/parts/b2324.js"; let s = fs.readFileSync(F, "utf8");
const a = `      const checked = bankPopup(P, true); // (if the fake shows its stand-in for the bank's 3D Secure check, confirm it)
      checked.catch(() => {});
      await P.locator("[data-chargeback-steps] button", { hasText: "Verify a card" }).click();
      if (await P.waitForSelector("[data-chargeback-steps] [data-step-ok=yes]", { timeout: 45000 }).then(() => true, () => false)) break;`;
if (!s.includes(a)) throw new Error("verify");
s = s.replace(a, () => `      await P.locator("[data-chargeback-steps] button", { hasText: "Verify a card" }).click();
      // The fake draws its stand-in for the bank's 3D Secure check under the button (the busy server can take a minute): confirm it.
      const standIn = P.locator("[data-bank-check=stand-in]").first();
      if (await standIn.waitFor({ timeout: 90000 }).then(() => true, () => false)) {
        await pause(P, 1200);
        await standIn.locator("[data-bank-confirm]").evaluate((b) => b.click());
      }
      if (await P.waitForSelector("[data-chargeback-steps] [data-step-ok=yes]", { timeout: 90000 }).then(() => true, () => false)) break;`);
s = s.replace(`const open = await P.locator("[data-bank-check=stand-in]").first().waitFor({ timeout: 8000 })`, `const open = await P.locator("[data-bank-check=stand-in]").first().waitFor({ timeout: 60000 })`);
fs.writeFileSync(F, s); console.log("ok");
