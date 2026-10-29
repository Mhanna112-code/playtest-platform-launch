// node assemble.cjs <name> [part ...]: writes scripts/media-run-<name>.cjs = scripts/media.cjs with the parts (parts/<part>.js, default <name>) inserted before the
// report manifest section. Run it from playtest-lite: BASE=http://localhost:3450 MEDIA_DB=playtest_lite_media ONLY=<groups> node scripts/media-run-<name>.cjs
// With "final": writes the parts into scripts/media.cjs itself (the merge).
const fs = require("fs"), path = require("path");
const ROOT = "C:/Users/march/Projects/playtest-lite";
const [name, ...partNames] = process.argv.slice(2);
const parts = (partNames.length ? partNames : [name]).map((p) => fs.readFileSync(path.join(__dirname, "parts", p + ".js"), "utf8"));
const base = fs.readFileSync(path.join(ROOT, "scripts", "media.cjs"), "utf8");
const MARK = "// ---------- the report manifest ----------";
if (!base.includes(MARK)) throw new Error("no manifest marker");
const out = base.replace(MARK, () => parts.join("\n\n") + "\n\n" + MARK);
const dst = name === "final" ? path.join(ROOT, "scripts", "media.cjs") : path.join(ROOT, "scripts", `media-run-${name}.cjs`);
fs.writeFileSync(dst, out);
console.log("wrote", dst);
