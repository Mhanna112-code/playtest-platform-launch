// Replaces the captions of named files in parts/blkct.js: node blkct-caps.cjs caps.json
const fs = require("fs");
const P = __dirname + "/parts/blkct.js";
let s = fs.readFileSync(P, "utf8");
const caps = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
for (const [name, cap] of Object.entries(caps)) {
  const re = new RegExp('("' + esc(name) + '",\\s*)"((?:[^"\\\\]|\\\\.)*)"', "g");
  const n = (s.match(re) || []).length;
  if (n !== 1) { console.log("! ", name, n); continue; }
  s = s.replace(re, (m, a) => a + JSON.stringify(cap));
}
fs.writeFileSync(P, s);
console.log("ok");
