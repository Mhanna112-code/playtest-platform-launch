// Applies the existing migrations to the rec_paymatrix schema ONLY (DATABASE_URL and DIRECT_URL both point at it). Lines with a URL are dropped.
const { env, WT } = require("./env.cjs");
const { spawnSync } = require("child_process");
const r = spawnSync("npx", ["prisma", "migrate", "deploy"], { cwd: WT, env: env(), shell: true, encoding: "utf8" });
const clean = (s) => (s || "").split("\n").filter((l) => !/postgres(ql)?:\/\//.test(l)).join("\n");
console.log(clean(r.stdout)); console.log(clean(r.stderr)); process.exit(r.status);
