// node sync-captions.cjs <part>: sets the caption and title in docs/media/captions.json of every file this part names ("name", "Title | caption"), for the
// files that exist (desktop and -phone), the same split the harness's record() makes. Prints what it changed.
const fs = require("fs"), path = require("path");
const part = fs.readFileSync(path.join(__dirname, "parts", (process.argv[2] || "blkct") + ".js"), "utf8");
const F = "C:/Users/march/Projects/playtest-lite/docs/media/captions.json";
const caps = JSON.parse(fs.readFileSync(F, "utf8"));
const re = /"((?:blk|ct)-[a-z0-9-]+)",\s*"((?:[^"\\]|\\.)*)"/g;
let n = 0;
for (const m of part.matchAll(re)) {
  const name = m[1], full = JSON.parse('"' + m[2] + '"');
  const mm = /^(.*?) \| (.*)$/s.exec(full);
  const title = mm ? mm[1] : "", text = mm ? mm[2] : full;
  for (const f of [`${name}.png`, `${name}-phone.png`, `${name}.webm`, `${name}-phone.webm`]) {
    if (!caps[f]) continue;
    if (caps[f].caption !== text || caps[f].title !== title) { caps[f].caption = text; caps[f].title = title; n++; console.log("updated", f); }
  }
}
fs.writeFileSync(F, JSON.stringify(caps, null, 2));
console.log(n, "entries updated");
