// Applies pending migrations to playtest_lite_media ONLY (DATABASE_URL and DIRECT_URL both point at it), from the worktree. Lines with a URL are dropped.
const { env, WT } = require("./env.cjs");
const { spawnSync } = require("child_process");
const e = env();
const r = spawnSync("npx", ["prisma", "migrate", "deploy"], { cwd: WT, env: e, shell: true, encoding: "utf8" });
const clean = (s) => (s || "").split("\n").filter((l) => !/postgres(ql)?:\/\//.test(l)).join("\n");
console.log(clean(r.stdout)); console.log(clean(r.stderr)); process.exit(r.status);
