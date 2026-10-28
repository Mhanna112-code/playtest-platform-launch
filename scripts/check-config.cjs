// (Batch 15 section 12) Runs before `next build` (package.json "build"): a bad setting fails the build with a plain message, so on Vercel the old version stays
// live until it's fixed. Missing optional settings only warn.
/* eslint-disable */
const path = require("path");
const root = path.join(__dirname, "..");
try {
  require("@next/env").loadEnvConfig(root);
} catch {
  // no .env loading outside a Next project: the environment as it is
}
const { configProblems } = require(path.join(root, "src/lib/configProblems.cjs"));
const problems = configProblems(process.env);
for (const p of problems) console[p.stopsBuild ? "error" : "warn"](`${p.stopsBuild ? "Settings problem" : "Settings warning"}: ${p.message}`);
if (problems.some((p) => p.stopsBuild)) {
  console.error("The build stopped: fix the settings above (on Vercel: Project Settings > Environment Variables), then deploy again.");
  process.exit(1);
}
