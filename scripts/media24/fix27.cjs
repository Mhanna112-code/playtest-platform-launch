const fs = require("fs"); const F = __dirname + "/parts/b20y.js"; let s = fs.readFileSync(F, "utf8");
const a = "§27 The same for Stop the test | Its required reason with “Done”: “Say a little more: at least 5 characters.”, and the pop-up's Stop the test stays disabled.";
if (!s.includes(a)) throw new Error("missing");
s = s.replace(a, "§27 The same for Stop the test | Stop's “Are you sure…?” pop-up, its required “Why? (testers read it)” with “Done”: red “Say a little more: at least 5 characters.”");
fs.writeFileSync(F, s); console.log("ok");
