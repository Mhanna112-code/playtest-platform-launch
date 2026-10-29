// node appfn.cjs <action> <email> [email=1]: checks the account is a throwaway (…@playtest.test, or the owner's marchanna111+pt… aliases for the email part),
// then runs appfn.mts with the 3460 server's environment (RESEND key only with email=1, and then with resend-guard.cjs preloaded).
const { spawnSync } = require("child_process");
const path = require("path");
const { execFileSync } = require("child_process");
const { env, WT } = require("./env.cjs");
const [action, email, withEmail] = process.argv.slice(2);
if (!/@playtest\.test$/.test(email) && !/^marchanna111\+pt[a-z0-9]+@gmail\.com$/i.test(email)) throw new Error("not a throwaway account");
const id = execFileSync("psql", ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", "playtest_lite_media", "-t", "-A", "-c", `select id from "User" where email = '${email.replace(/'/g, "''")}'`]).toString().trim();
if (!id) throw new Error("no such account");
const e = env({ withEmail: withEmail === "email=1" });
if (withEmail === "email=1") { e.NODE_OPTIONS = `--require ${path.join(__dirname, "resend-guard.cjs").replace(/\\/g, "/")}`; e.RESEND_GUARD_DIR = process.env.MEDIA_STRIPE_LOGS || path.join(__dirname, "logs"); }
const r = spawnSync(process.execPath, [path.join(WT, "node_modules", "vite-node", "vite-node.mjs"), "--config", path.join(__dirname, "appfn.config.mjs"), path.join(__dirname, "appfn.mts"), action, id], { cwd: WT, env: e, encoding: "utf8" });
const out = ((r.stdout || "") + (r.stderr || "")).replace(/\b(sk|pk|rk)_(test|live)_[A-Za-z0-9]+/g, "[key]").replace(/whsec_[A-Za-z0-9]+/g, "[secret]");
const m = /RESULT (.*)/.exec(out);
if (!m) { console.error(out.slice(-2000)); process.exit(1); }
console.log(m[1]);
