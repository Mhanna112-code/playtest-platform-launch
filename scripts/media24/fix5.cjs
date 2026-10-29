const fs = require("fs"); const F = __dirname + "/parts/b2324.js"; let L = fs.readFileSync(F, "utf8").split("\n");
// reserve: lines 34-39 (1-based)
L.splice(33, 6,
"  const reserve = async (P) => {",
"    for (let i = 0; i < 3; i++) {",
"      const b = P.locator(\"#owed button:not([disabled])\", { hasText: /Pay what you owe/ });",
"      await b.waitFor({ timeout: 60000 });",
"      await pause(P, 2500); // (after a reload the button works once the page has hydrated)",
"      const pop = bankPopup(P, true); // (if the bank's check opens inline, confirm it)",
"      pop.catch(() => {});",
"      await b.click();",
"      if (await P.waitForSelector(\"text=/Reserved \\$/\", { timeout: 40000 }).then(() => true, () => false)) return;",
"      console.log(\"   (Pay what you owe: no reserved line yet, pressing again)\");",
"      await P.reload();",
"    }",
"    throw new Error(\"no reservation after three presses\");",
"  };");
fs.writeFileSync(F, L.join("\n"));
