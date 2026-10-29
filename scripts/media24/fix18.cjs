const fs = require("fs"); const F = __dirname + "/parts/b20y.js"; let s = fs.readFileSync(F, "utf8");
const a = `, D.locator("#calls [data-length-row]").locator("xpath=ancestor::form[1]"));`;
if (!s.includes(a)) throw new Error("missing");
s = s.replace(a, () => `, D.locator("#calls [data-length-row]"));`).replace('await shot(D, "b20-18-kept", `', 'await shotSpan(D, "b20-18-kept", `').replace(/(shotSpan\(D, "b20-18-kept", `[^`]*`), D\.locator\("#calls \[data-length-row\]"\)\);/, '$1, D.locator("#calls fieldset").first(), D.locator("#calls [data-length-row]"));');
fs.writeFileSync(F, s); console.log(s.match(/shotSpan\(D, "b20-18-kept"[^\n]*/)[0].slice(-120));
