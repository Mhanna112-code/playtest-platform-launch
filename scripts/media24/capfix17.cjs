const fs = require("fs");
const F = __dirname + "/parts/b20y.js";
let s = fs.readFileSync(F, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing " + a.slice(0, 60)); s = s.replace(a, () => b); };
rep("“§17 Before the block | Nora's profile as Ana sees it: Chat with, the Open tests list, Report and Block.”".slice(1, -1),
  "§17 Before the block | Nora's profile as Ana sees it: the stats, Open tests listing “Sky Lab: tutorial” and “Harbor Run: first 3 levels”, then “Report Nora Lane” and “Block Nora Lane”.");
rep("§17 You blocked them | The profile still opens (name, ratings, stats, bio); where Block was there's “Unblock Nora Lane”, no Chat with or invite, and Open tests reads “You blocked Nora Lane, so their tests are hidden.”",
  "§17 You blocked them | The profile still opens (name, stats, ratings); Open tests reads “You blocked Nora Lane, so their tests are hidden.”, and where Block was there's “Unblock Nora Lane” (Report Nora Lane stays).");
rep("§17 Unblock | One press, no confirm: “Unblocked.”, and the profile comes back in full: Chat with, Open tests and Block.",
  "§17 Unblock | One press, no confirm, and the profile comes back in full at once: Open tests lists both tests again, with “Block Nora Lane” back under Report.");
fs.writeFileSync(F, s);
console.log("ok");
