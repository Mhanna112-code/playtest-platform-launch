// Builds the 3517 recording server (production, .next-3517) with the same environment as supervisor.cjs runs it with; key values filtered from the output.
const { spawnSync } = require("child_process");
const path = require("path");
const { env, WT, red } = require("./env.cjs");
const r = spawnSync(process.execPath, [path.join(WT, "node_modules", "next", "dist", "bin", "next"), "build"], { cwd: WT, env: { ...env(), NODE_ENV: "production", NODE_OPTIONS: "--max-old-space-size=4096" }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
console.log(red((r.stdout || "") + (r.stderr || "")).split("\n").slice(-40).join("\n"));
process.exit(r.status ?? 1);
