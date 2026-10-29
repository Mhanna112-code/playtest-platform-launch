const fs = require("fs");
const F = __dirname + "/parts/b20y.js";
let s = fs.readFileSync(F, "utf8");
const a = "  const b20acct = async (...a) => b20slow(await account(...a));\n";
if (!s.includes(a)) throw new Error("missing acct");
s = s.replace(a, () => `  // A sign-up that half went through (the server dropped the answer) is retried as a fresh account (a new address), never the same one again.
  const b20acct = async (email, ...rest) => {
    for (let i = 0; ; i++) {
      try { return b20slow(await account(i ? email.replace("@", \`r\${i}@\`) : email, ...rest)); } catch (e) {
        if (i >= 3) throw e;
        console.log("   (sign-up retried after:", String(e.message || e).slice(0, 100) + ")");
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
`);
s = s.split("await b20R(b20acct, ").join("await b20acct(");
fs.writeFileSync(F, s);
console.log("ok");
