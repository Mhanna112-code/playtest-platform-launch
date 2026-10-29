const fs = require("fs"); const F = __dirname + "/parts/b20y.js"; let s = fs.readFileSync(F, "utf8");
const a = "§28 A required answer missing | “Where did you get stuck?” left empty: the red line is at that question (and the list above the button names it), not only under the button.";
if (!s.includes(a)) throw new Error("missing");
s = s.replace(a, "§28 A required answer missing | “Where did you get stuck?” left empty: the red line “Answer every required question before sending.” sits right under that question's box (which gets the focus), not only under the button.");
fs.writeFileSync(F, s); console.log("ok");
