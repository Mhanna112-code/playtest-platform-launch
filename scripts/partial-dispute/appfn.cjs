// node appfn.cjs <action> [arg]: runs appfn.mts with the 3485 server's environment (rec_dispute schema, Stripe test key). Prints only the RESULT line (keys hidden).
/* eslint-disable */
const { spawnSync } = require("child_process");
const path = require("path");
const { env, WT, red } = require("./env.cjs");
function appfn(action, arg = "") {
  const r = spawnSync(process.execPath, [path.join(WT, "node_modules", "vite-node", "vite-node.mjs"), "--config", path.join(__dirname, "appfn.config.mjs"), path.join(__dirname, "appfn.mts"), action, arg], { cwd: WT, env: env(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = red((r.stdout || "") + (r.stderr || ""));
  const m = /RESULT (.*)/.exec(out);
  if (!m) throw new Error(`appfn ${action} failed: ${out.slice(-2000)}`);
  return JSON.parse(m[1]);
}
module.exports = { appfn };
if (require.main === module) console.log(JSON.stringify(appfn(process.argv[2], process.argv[3]), null, 2));
