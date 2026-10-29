const fs = require("fs"); const F = __dirname + "/parts/b2324.js"; const L = fs.readFileSync(F, "utf8").split("\n");
if (!L[57].includes("const confirmBank")) throw new Error("line");
L.splice(57, 10,
"  const confirmBank = async (P, box) => {",
"    const standIn = P.locator(\"[data-bank-check=stand-in]\").first();",
"    for (let i = 0; i < 3; i++) {",
"      await box.locator(\"button\", { hasText: \"Confirm with your bank\" }).click();",
"      // The bank's check (the fake's stand-in), or a stop box first (pressed again); the busy server can take a minute.",
"      const end = Date.now() + 90000;",
"      let what = \"\";",
"      while (!what && Date.now() < end) {",
"        if (await standIn.isVisible().catch(() => false)) what = \"check\";",
"        else if (await box.locator(\"text=/again to go ahead/\").count()) what = \"stop\";",
"        else await P.waitForTimeout(700);",
"      }",
"      if (what === \"check\") { await pause(P, 1200); await standIn.locator(\"[data-bank-confirm]\").evaluate((b) => b.click()); return; }",
"      console.log(\"   (Confirm stopped first:\", (await box.innerText()).replace(/\s+/g, \" \").slice(0, 300), \")\");",
"    }",
"  };");
fs.writeFileSync(F, L.join("\n")); console.log("ok");
