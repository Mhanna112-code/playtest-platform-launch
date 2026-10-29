const fs = require("fs"); const F = __dirname + "/parts/b2324.js"; const L = fs.readFileSync(F, "utf8").split("\n");
if (!L[24].includes("const verifyCard")) throw new Error("line");
L.splice(24, 8,
"  const verifyCard = async (P) => {",
"    for (let i = 0; i < 3; i++) {",
"      await pause(P, 2500); // (the button works once the page has hydrated)",
"      const checked = bankPopup(P, true); // (if the fake shows its stand-in for the bank's 3D Secure check, confirm it)",
"      checked.catch(() => {});",
"      await P.locator(\"[data-chargeback-steps] button\", { hasText: \"Verify a card\" }).click();",
"      if (await P.waitForSelector(\"[data-chargeback-steps] [data-step-ok=yes]\", { timeout: 45000 }).then(() => true, () => false)) break;",
"      console.log(\"   (the card check didn't tick yet: pressing Verify a card again)\");",
"      await P.reload();",
"    }",
"    await P.locator(\"#owed button:not([disabled])\", { hasText: /Pay what you owe/ }).waitFor({ timeout: 60000 });",
"    await pause(P, 800);",
"  };");
fs.writeFileSync(F, L.join("\n"));
