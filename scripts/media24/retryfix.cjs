const fs = require("fs");
const F = __dirname + "/parts/b20y.js";
let s = fs.readFileSync(F, "utf8");
if (s.includes("const b20R =")) throw new Error("already applied");
const helper = `  // (Busy shared server tonight: a call that fails on the server's side, or a dropped connection, is tried again a few times.)
  const b20R = async (fn, ...a) => {
    for (let i = 1; ; i++) {
      try { return await fn(...a); } catch (e) {
        if (i >= 4 || !/on our side|ECONNRESET|ECONNREFUSED|socket hang up/i.test(String(e))) throw e;
        console.log("   (retrying after:", String(e.message || e).slice(0, 120) + ")");
        await new Promise((r) => setTimeout(r, 4000 * i));
      }
    }
  };
  const b20ok = (page, p, body, what) => b20R(async () => ok(await post(page, p, body), what));
`;
s = s.replace('  const B20 = "Batch 20 (Oct 29)";\n', (m) => m + helper);
let n = 0;
for (const f of ["postTest", "join", "sendWritten", "apiPay", "payWith", "rateDev", "subscribeDev", "b20payMore", "apiEdit", "b20acct"]) {
  s = s.split(`await ${f}(`).join(`await b20R(${f}, `);
  n++;
}
s = s.replace(/ok\(await post\(([^;]*?)\), ("[^"]*")\)/g, (m, inner, w) => { n++; return `await b20ok(${inner}, ${w})`; });
s = s.split("await await b20ok").join("await b20ok");
fs.writeFileSync(F, s);
console.log("done", n);
