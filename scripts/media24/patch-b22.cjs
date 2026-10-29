const fs = require("fs");
const F = __dirname + "/parts/b2122.js";
let s = fs.readFileSync(F, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing " + a.slice(0, 70)); s = s.split(a).join(b); };
// Retries: a fresh admin email too (adminAccount names it after GROUP).
rep(`      R = n ? "r" + n : "";
      try { await fn(); return; } catch (e) {`, `      R = n ? "r" + n : "";
      const g0 = GROUP;
      if (n) GROUP = id + R;
      try { await fn(); return; } catch (e) {`);
rep(`      } finally { await closeSecond(); }
    }
  }, opts);`, `      } finally { await closeSecond(); GROUP = g0; }
    }
  }, opts);`);
// b22a captions
rep(`"§1 A payment hold retries | During a payment hold Payments shows what's owed with “Last try: <time> · next try: <time>” (the daily automatic try, up to 7)."`,
  `"§1 A payment hold retries | Nora's card was declined on Ben's answers: during the payment hold Payments shows “Last try: <time> · next try: <the next day>” above what's owed (the daily automatic try, up to 7), with Pay what you owe ($12.00)."`);
rep("`§1 A chargeback hold never retries | The same account after a chargeback: the three steps and what's owed, with no “next try” line; the daily job charged nothing (charged payments ${before} before, ${after} after) although the card works again.`",
  "`§1 A chargeback hold never retries | A chargeback on Ana's earlier payment turns the hold into a chargeback hold: “Your bank reversed a payment, so your account is on a payment hold.”, the three steps (a card verified with 3D Secure, what you owe reserved on your card, the team's approval) and what's owed ($12 + $15 chargeback fee, and Ben's $12.00): there's no “next try” line any more, and the daily job charged nothing (charged payments ${before} before, ${after} after) although the card works again.`");
// b22b caption
rep("`§2 A suspended tester is paid normally | Cam is suspended, Nora paid their answers, and the team's view of Cam lists the payout like any other (transfer ${tr.split(\" \")[0]}): nothing is held.`",
  "`§2 A suspended tester is paid normally | Cam is suspended (“Suspended (tester side)”) and Nora paid their answers afterwards: the team's view of Cam reads “Total paid out $8.00” and Payouts to them “$8.00 from <Nora> (review) · payout sent”; nothing is held (transfer ${tr.split(\" \")[0]}).`");
// b22c: one picture
rep(`    await shot(admin, "b22-04-timeline", "§4 The team's timeline | On the test's page, “For the team (only admins see this)” speaks in the third person: “Nora Lane paid Cam Lee $10.00 …”, the pause and the developer account's suspension naming who, one line for Ana's dispute with the reason in italics and one for the decision naming the admin.", target);
    await shot(admin, "b22-04-boxes", "§4 The three lists | Timeline, Contract changes and Payments are scroll boxes of about 10 rows that load more as you scroll.", "#admin-boxes");`,
  `    await shot(admin, "b22-04-timeline", "§4 The team's timeline | On the test's page, “For the team (only admins see this)” speaks about people: “Nora Lane paid Cam Lee $10.00 for the written answers”, one line for Ana's dispute with the reason in italics (“Ana Silva disputed the pay for their written answers: …”), one for the decision naming the admin (“<admin> decided Ana Silva's dispute: raised the pay to $8.00 ($8.00 more)”), “<admin> paused this test” / “lifted the pause on this test”, “Nora Lane's developer account was paused (by <admin>)” and “Nora Lane's tests are running again”. Timeline (12) scrolls in its box; Contract changes and Payments end with “That's all (N)”.", target);`);
// b22d: wait for Ada's own answer first; a re-pause that finds it still paused goes on.
rep(`    await testRow(L, t).locator("button", { hasText: "Lift the pause" }).click();
    await pause(L, 800);`, `    await testRow(L, t).locator("button", { hasText: "Lift the pause" }).click();
    const mineL = L.locator(\`[data-test-row="\${t}"] .ok, [data-test-row="\${t}"] .err, [data-test-row="\${t}"] .info\`).first();
    await mineL.waitFor({ timeout: 60000 }).catch(() => {});
    console.log(\`   §5 Ada's Lift: “\${await mineL.innerText().catch(() => "")}”; paused now: \${sql(\`select "adminPausedAt" is not null from "Test" where id = '\${t}'\`)}\`);
    await pause(L, 800);`);
rep(`    await adminDo(a1, "pause-test", t, { note: "Media pass check: again." });`, `    await post(a1, "/api/admin/pause-test", { id: t, note: "Media pass check: again." });`);
fs.writeFileSync(F, s);
console.log("ok");
