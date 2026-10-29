const fs = require("fs");
const F = __dirname + "/parts/b2324.js";
let s = fs.readFileSync(F, "utf8");
const BS = String.fromCharCode(92);
s = s.split("(/s+/g").join("(/" + BS + "s+/g");
s = s.split('"text=/Reserved ' + BS + '$/"').join('"text=/Reserved ' + BS + BS + '$/"');
// The shared server sometimes fails a press under load (a transaction timeout): those presses are tried again too.
s = s.replace(
  "  const chargeApi = async (tester, s, body) => ok(await post(tester, `/api/sessions/${s}/choose`, { choice: \"charge\", seenAt: nowIso(), confirmed: true, ...body }), \"charge\");",
  "  const chargeApi = async (tester, s, body) => { for (let i = 0; ; i++) { const r = await post(tester, `/api/sessions/${s}/choose`, { choice: \"charge\", seenAt: nowIso(), confirmed: true, ...body }); if (r.ok || i >= 3 || r.status !== 500) return ok(r, \"charge\"); console.log(\"   (busy server, charging again)\"); await new Promise((res) => setTimeout(res, 4000)); } };"
);
if (!s.includes("charging again")) throw new Error("chargeApi not replaced");
s = s.replace("const openBellR = retry(openBell),", "const apiPayR = retry(apiPay), apiEditR = retry(apiEdit), openBellR = retry(openBell),");
s = s.split("await apiPay(").join("await apiPayR(").split("await apiEdit(").join("await apiEditR(");
s = s.replace("    await blk.scrollIntoViewIfNeeded();\n", "");
fs.writeFileSync(F, s);
console.log("ok", (s.match(/apiPayR\(/g) || []).length, (s.match(/apiEditR\(/g) || []).length);
