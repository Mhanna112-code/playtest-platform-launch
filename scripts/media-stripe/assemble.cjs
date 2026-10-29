// Writes scripts/media-run-stripe.cjs = scripts/media.cjs with part.js inserted before its report-manifest section (as scripts/media24/assemble.cjs does).
// Run from playtest-lite: BROWSER_CHANNEL=chrome BASE=http://localhost:3460 MEDIA_DB=playtest_lite_media ONLY=st1 SIZES=desktop node scripts/media-run-stripe.cjs
// The copy's Chrome is started with its Local Network Access checks off: the bank's check runs in a frame on hooks.stripe.com (a public page) and returns to
// http://localhost:3460/api/payments/bank-return, which Chrome otherwise blocks ("The connection is blocked because it was initiated by a public page to connect to
// devices or servers on your local network."). On the real, public site there is no local address, so the check returns as usual.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const base = fs.readFileSync(path.join(ROOT, "scripts", "media.cjs"), "utf8");
const MARK = "// ---------- the report manifest ----------";
const LAUNCH = `args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]`;
if (!base.includes(MARK)) throw new Error("no manifest marker");
if (!base.includes(LAUNCH)) throw new Error("no browser launch line");
const out = base
  .replace(MARK, () => fs.readFileSync(path.join(__dirname, "part.js"), "utf8") + "\n\n" + MARK)
  .replace(LAUNCH, () => `args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"]`);
fs.writeFileSync(path.join(ROOT, "scripts", "media-run-stripe.cjs"), out);
console.log("wrote scripts/media-run-stripe.cjs");
