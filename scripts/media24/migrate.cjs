const { env, ROOT } = require("./mediaenv.cjs");
const { spawnSync } = require("child_process");
const r = spawnSync("npx", ["prisma", "migrate", "deploy"], { cwd: ROOT, env: env(), shell: true, encoding: "utf8" });
// prisma prints the datasource host/db (no password); still, drop any line with a URL
const clean = (s) => (s || "").split("\n").filter((l) => !/postgres(ql)?:\/\//.test(l)).join("\n");
console.log(clean(r.stdout)); console.log(clean(r.stderr)); process.exit(r.status);
