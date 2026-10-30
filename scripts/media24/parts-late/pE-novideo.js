// ---------- (Oct 29 evening media run, part pE) The bell after batch 29, the bell's number, batch 25 (confirm-by in the developer's zone, retried chargeback, renewal
// line, one retry line), batch 28 §8 (a Charge after the reservation) with the b23-06-reserve-video re-record, and batch 28 §18 (the payment email with email Off) ----------
{
  const BELL = "Bell and emails", B25 = "Batch 25 (Oct 29)", B28 = "Batch 28 (Oct 29)", B23 = "Batch 23 (Oct 29)";
  const U = "(now() at time zone 'utc')";
  /** (The shared media server answers slowly tonight: every page of these groups waits up to 4 minutes for a load and 30 seconds for an element.) */
  const patient = () => {
    if (browser._patient) return;
    browser._patient = true;
    const orig = browser.newContext.bind(browser);
    browser.newContext = async (o) => {
      const c = await orig(o);
      const st = c.setDefaultTimeout.bind(c), sn = c.setDefaultNavigationTimeout.bind(c);
      c.setDefaultTimeout = (ms) => st(Math.max(ms, 30000));
      c.setDefaultNavigationTimeout = (ms) => sn(Math.max(ms, 240000));
      return c;
    };
  };
  /** A set-up call tried again once or twice (the server is shared with other recordings). */
  const again = async (fn, what) => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) {
        if (i >= 2) throw e;
        console.log(`   (retrying ${what}: ${String(e.message || e).split("\n")[0].slice(0, 120)})`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  /** A new account, tried again with a fresh address if the server dropped the first try part-way. */
  const acct = async (email, ...rest) => {
    patient();
    for (let i = 0; ; i++) {
      try { return await account(i ? email.replace("@", `r${i}@`) : email, ...rest); } catch (e) {
        if (i >= 2) throw e;
        console.log(`   (retrying the account: ${String(e.message || e).split(String.fromCharCode(10))[0].slice(0, 120)})`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  const postT = (dev, over) => again(() => postTest(dev, over), "post a test");
  const subD = (dev) => again(() => subscribeDev(dev).catch((e) => { if (!/already subscribed/.test(String(e.message))) throw e; }), "subscribe");
  const sendW = (t, s, a) => again(() => sendWritten(t, s, a), "send");
  const joinT = (t, id) => again(() => join(t, id), "join");
  const payR = (d, sub, dollars) => again(() => apiPay(d, sub, dollars), "pay");
  const openR = (p, url, sel) => again(async () => { await p.goto(url, { timeout: 240000 }); if (sel) await p.waitForSelector(sel, { timeout: 60000 }); await pause(p, 700); }, "open " + url);
  const say = async (loc) => (await loc.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  const ago = (d) => `${U} - interval '${d} days'`;
  const placeTest = (t, created, until) => own(`update "Test" set "createdAt" = ${ago(created)}, "openUntil" = ${ago(until)} where id = '${t}'`);
  const placeTester = (s, joined, due) => own(`update "Contract" set "joinedAt" = ${ago(joined)}, "dueAt" = ${ago(due)} where id = '${s}'`);
  const placeSent = (sub, sent) => own(`update "Submission" set "sentAt" = ${ago(sent)}, "updatedAt" = ${ago(sent)}, "payBy" = ${ago(sent - 7)} where id = '${sub}'`);
  /** The 5-minute sweep (keyed health check) until `done()` holds (up to 5 minutes; pinged again every 20 seconds). */
  const sweepLong = async (done, what) => {
    const end = Date.now() + 300000;
    while (Date.now() < end) {
      fetch(`${BASE}/api/health?key=${HEALTH_KEY}`).catch(() => null);
      for (let i = 0; i < 10 && Date.now() < end; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (done()) return true;
      }
    }
    console.log("   ! sweep: nothing yet for", what);
    return false;
  };
  const lines = (uid, like) => Number(sql(`select count(*) from "Notification" where "userId" = '${uid}' and text like ${lit(like)}`));
  /** A tester's Charge through the API (the session page's own press). */
  const chargeApi = async (tester, s, body) => { for (let i = 0; ; i++) { const r = await post(tester, `/api/sessions/${s}/choose`, { choice: "charge", seenAt: nowIso(), confirmed: true, ...body }); if (r.ok || i >= 3 || r.status !== 500) return ok(r, "charge"); await new Promise((res) => setTimeout(res, 4000)); } };
  const applyTo = (tester, id) => again(() => post(tester, `/api/tests/${id}/apply`, { ...go, note: "I play a lot of games like this one." }).then((r) => ok(r, "apply")), "apply");
  const appOf = (testId, testerId) => sql(`select id from "Application" where "testId" = '${testId}' and "testerId" = '${testerId}' order by "createdAt" desc limit 1`);
  const answer = (dev, testId, testerId, action) => post(dev, `/api/tests/${testId}/application`, { ...go, seenAt: nowIso(), applicationId: appOf(testId, testerId), action }).then((r) => ok(r, action + " application"));
  /** The Notifications page, waiting for its list. */
  const bellPage = async (p) => { await openR(p, "/app/notifications", "main ul.card"); await pause(p, 800); };
  /** The bell list's entries as the page shows them (a stack's title, or a single line). */
  const entries = async (p) => (await p.locator("main ul.card > li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const stack = (p, title) => p.locator("[data-bell-stack]", { hasText: title }).first();
  const stackTitle = async (p, title) => say(stack(p, title).locator(":scope > button span span").first());
  /** Opens one stack (a press, as the person does). */
  const expand = async (p, title) => {
    const b = stack(p, title).locator(":scope > button");
    if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
    await pause(p, 700);
    const more = stack(p, title).locator("button", { hasText: /^Show \d+ more$/ });
    if (await more.count()) { await more.first().click(); await pause(p, 400); }
  };
  /** The single line (or stacked line) with this text. */
  const lineLoc = (p, text) => p.locator("[data-bell-line]", { hasText: text }).first();
  const bellCount = async (p) => p.locator("header [data-bell-count]").first().getAttribute("data-bell-count");
  /** Bug words a tester's screen should never show about a developer. */
  const checkTester = async (p, who) => {
    const t = await say(p.locator("main"));
    const hit = t.match(/[^.]*\b(hold|suspended|failed|chargeback)\b[^.]*/gi);
    if (hit) console.log(`   ! ${who}'s bell names a hold / suspension / failure / chargeback:`, JSON.stringify(hit.slice(0, 4)));
    return hit;
  };

  // ---------- Batch 23 helpers (copied: block-scoped there) ----------
  /** The run's admin. (Sign-up lowercases emails: the harness's admin address carries the group id "pE…", so its isAdmin update is made again here, lowercased.) */
  const adminA = async () => {
    const a = await adminAccount();
    a.email = a.email.toLowerCase();
    own(`update "User" set "isAdmin" = true where email = ${lit(a.email)}`);
    return slowOk(a);
  };
  const slowOk = (p) => { p.context().setDefaultTimeout(60000); p.context().setDefaultNavigationTimeout(120000); return p; };
  const go3 = async (p, u) => { for (let i = 0; ; i++) { try { return await p.goto(u, { timeout: 180000 }); } catch (e) { if (i >= 2) throw e; console.log("   (slow page, trying again)", u); await p.waitForTimeout(2000); } } };
  const verifyCard = async (P) => {
    for (let i = 0; i < 3; i++) {
      await pause(P, 2500);
      await P.locator("[data-chargeback-steps] button", { hasText: "Verify a card" }).click();
      const standIn = P.locator("[data-bank-check=stand-in]").first();
      if (await standIn.waitFor({ timeout: 90000 }).then(() => true, () => false)) {
        await pause(P, 1200);
        await standIn.locator("[data-bank-confirm]").evaluate((b) => b.click());
      }
      if (await P.waitForSelector("[data-chargeback-steps] [data-step-ok=yes]", { timeout: 90000 }).then(() => true, () => false)) break;
      console.log("   (the card check didn't tick yet: pressing Verify a card again)");
      await P.reload();
    }
    await P.locator("#owed button:not([disabled])", { hasText: /Pay what you owe/ }).waitFor({ timeout: 60000 });
    await pause(P, 800);
  };
  const reserve = async (P) => {
    for (let i = 0; i < 3; i++) {
      const b = P.locator("#owed button:not([disabled])", { hasText: /Pay what you owe/ });
      await b.waitFor({ timeout: 60000 });
      await pause(P, 2500);
      const pop = bankPopup(P, true);
      pop.catch(() => {});
      await b.click();
      if (await P.waitForSelector("text=/Reserved \\$/", { timeout: 40000 }).then(() => true, () => false)) return;
      console.log("   (Pay what you owe: no reserved line yet, pressing again)");
      await P.reload();
    }
    throw new Error("no reservation after three presses");
  };
  const cbRow = async (A, uid) => {
    await go3(A, `/admin?at=${Date.now()}#chargebacks`);
    const sel = `[data-chargeback-hold="${uid}"]`;
    await pageTo(A, "chargebacks", sel);
    const row = A.locator(sel).first();
    await row.scrollIntoViewIfNeeded();
    await pause(A, 900);
    return row;
  };
  /** A chargeback on a paid piece: the developer's payment hold becomes a chargeback hold. */
  const chargeback = (sub) => again(() => webhook("charge.dispute.created", { payment_intent: piOf(sub), status: "needs_response" }), "chargeback webhook");

  // ---------- Emails helpers (copied from the Emails block) ----------
  const outboxRow = (to, like) => {
    const id = sql(`select id from "OutboxEmail" where ${to ? `"to" = ${lit(to)} and ` : ""}subject like ${lit(like)} order by "createdAt" desc limit 1`);
    if (!id) return null;
    const get = (col) => Buffer.from(sql(`select encode(convert_to(${col}, 'UTF8'), 'base64') from "OutboxEmail" where id = '${id}'`).replace(/\s+/g, ""), "base64").toString("utf8");
    return { id, to: get(`"to"`), subject: get("subject"), text: get("text"), html: get("html"), at: get(`to_char("createdAt", 'YYYY-MM-DD HH24:MI')`) };
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const tidy = (s) => String(s).replace(/(\/(reset|verify|confirm)[/=])[A-Za-z0-9_-]{12,}/g, "$1&lt;token&gt;").replace(/token=[A-Za-z0-9_-]{12,}/g, "token=&lt;token&gt;");
  const mailShot = async (page, row, name, caption) => {
    if (!row) { console.log("   ! no email for", name); return; }
    const body = row.html
      ? `<div class="html">${tidy(row.html)}</div>`
      : row.text.split("\n").map((l) => (/^https?:\/\//.test(l) ? `<p><a href="#">${tidy(esc(l))}</a></p>` : l.startsWith("• ") ? `<p class="li">${tidy(esc(l)).replace(/ (https?:\/\/\S+)$/, ' <a href="#">$1</a>')}</p>` : `<p>${tidy(esc(l)) || "&nbsp;"}</p>`)).join("");
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{margin:0;background:#e9edf3;font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827}
      .mail{max-width:760px;margin:16px auto;background:#fff;border:1px solid #d6dbe3;border-radius:10px;overflow:hidden}
      .head{padding:14px 18px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-size:13px;color:#4b5563}
      .head b{color:#111827}.subj{font-size:18px;font-weight:600;color:#111827;margin:6px 0 2px}
      .body{padding:16px 18px;word-break:break-word}.body p{margin:0 0 4px}.li{padding-left:2px}a{color:#2563eb}
      .kind{font-size:12px;color:#6b7280;padding:8px 18px;border-top:1px solid #eef0f4;background:#fafafa}
    </style></head><body><div class="mail" id="mail"><div class="head"><div>From <b>Playtest</b> · To <b>${esc(row.to)}</b> · ${esc(row.at)} UTC</div><div class="subj">${esc(row.subject)}</div></div>
    <div class="body">${body}</div><div class="kind">${row.html ? "HTML part, as sent" : "Plain-text email (no HTML part), shown line by line as the dev outbox shows it"}</div></div></body></html>`);
    await page.waitForTimeout(300);
    await shot(page, name, caption, "#mail");
  };

  /**
   * The recording cut to the given wall-clock windows ([start, end] in Date.now() ms), so a slow server's waits between the steps don't fill the video (both pages of a
   * split screen are cut to the same windows, so they stay in step). Returns the cut file (in the temp folder) to hand to finishVideo with from: 0.
   */
  const cutTo = (page, file, wins) => {
    const segs = wins.map(([a, b]) => [Math.max(0, (a - page.t0) / 1000), Math.max(0, (b - page.t0) / 1000)]).filter(([a, b]) => b > a + 0.2);
    const expr = segs.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join("+");
    const out = file.replace(/\.webm$/, "-cut.webm");
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", file, "-vf", `fps=25,select='${expr}',setpts=N/25/TB`, "-an", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "3M", out]);
    return out;
  };
  /** A wall-clock time in a time zone: the day `dayOffset` days from today there, at h:m there. */
  const zoned = (tz, dayOffset, h, m) => {
    const parts = (t, o) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", ...o }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const d = parts(Date.now() + dayOffset * 86400000, {});
    const guess = Date.UTC(+d.year, +d.month - 1, +d.day, h, m);
    const off = (t) => { const p = parts(t, { hour: "2-digit", minute: "2-digit", second: "2-digit" }); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t; };
    return new Date(guess - off(guess - off(guess)));
  };
  const inZone = (d, tz) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // =====================================================================================================================================================
  // pE1: the bell's stacks after batch 29 (§21-§27, §29, §31-§33): a developer, a tester and an admin, lines from several tests.
  group("pE1", async () => {
    const vera = await acct(`dev+media${TS}pe1v@playtest.test`, "Vera Holt", "developer", "they");
    await subD(vera);
    const kit = await acct(`tester+media${TS}pe1k@playtest.test`, "Kit Moreau", "tester", "they");
    const jun = await acct(`tester+media${TS}pe1j@playtest.test`, "Jun Abara", "tester", "they");
    const admin = await adminA();
    const T = {};
    for (const [k, productName, title, more] of [
      ["A", "Harbor Run", "Harbor Run: first 3 levels", { writtenCents: "10.00" }],
      ["B", "Sky Lab", "Sky Lab: tutorial", { writtenCents: "12.00", categories: ["Education"] }],
      ["F", "Tide Tracker", "Tide Tracker: widgets", { writtenCents: "8.00", categories: ["Productivity"] }],
      ["G", "Pocket Chef", "Pocket Chef: recipe search", { writtenCents: "9.00", categories: ["Shopping"] }],
      ["C", "Night Market", "Night Market demo", { joinMode: "apply" }],
      ["D", "Glow Garden", "Glow Garden: night levels", { joinMode: "apply" }],
      ["E", "Coral Quest", "Coral Quest: boss fight", { joinMode: "apply" }],
      ["I", "Budget Buddy", "Budget Buddy: sign-up flow", { joinMode: "apply", categories: ["Finance"] }],
      ["H", "Lumen Notes", "Lumen Notes private beta", { joinMode: "invite", categories: ["Productivity"] }],
    ]) T[k] = await postT(vera, { productName, title, ...more });
    // §21 Ratings: Vera pays Kit on two tests (Kit's "Rate Vera Holt on …" ×2); Kit rates both (Vera's "Kit Moreau finished … You can rate them for 14 days." ×2).
    const S = {};
    for (const k of ["F", "G"]) {
      S[k + "k"] = await joinT(kit, T[k]);
      S[k + "j"] = await joinT(jun, T[k]);
      await sendW(kit, S[k + "k"]);
      await sendW(jun, S[k + "j"]);
    }
    await payR(vera, subOf(S.Fk), "8.00");
    await payR(vera, subOf(S.Gk), "9.00");
    await again(() => rateDev(kit, S.Fk, 5, "Clear steps and quick pay."), "rate");
    await again(() => rateDev(kit, S.Gk, 5, "Friendly and fast."), "rate");
    // §29 Two disputes and a report for the admins.
    for (const k of ["F", "G"]) {
      const sub = subOf(S[k + "j"]);
      await again(() => rejectPiece(vera, sub, "The answers don't match this build."), "reject");
      await again(() => disputeOf(jun, S[k + "j"], sub, "I played the build for an hour; every answer is about it."), "dispute");
    }
    await again(() => post(jun, "/api/reports", { ...go, userId: vera.uid, note: "Rejected my answers on two tests without reading them." }).then((r) => ok(r, "report")), "report");
    await again(() => post(kit, "/api/reports", { ...go, userId: jun.uid, note: "Posted my test notes in a public chat." }).then((r) => ok(r, "report")), "report");
    // §24 Joined: Kit applies to two Approved-only tests; Vera accepts one and declines the other.
    for (const k of ["C", "D", "E", "I"]) await applyTo(kit, T[k]);
    await again(() => answer(vera, T.C, kit.uid, "accept"), "accept");
    await again(() => answer(vera, T.D, kit.uid, "decline"), "decline");
    // §23 Applications and invites: two listings change (Kit's applications close) and an invite is sent again on a new listing.
    await again(() => post(vera, `/api/tests/${T.H}/invite`, { ...go, testerIds: [kit.uid] }).then((r) => ok(r, "invite")), "invite");
    for (const k of ["E", "I", "H"]) await again(() => apiEdit(vera, T[k], { buildUrl: `https://example.com/new-build-${k.toLowerCase()}` }), "edit");
    // §22, §31 Charge or let go / Pay now / Closing soon: Kit's and Jun's answers on two tests, never paid, past their review dates (dates moved for this run's rows).
    for (const k of ["A", "B"]) {
      S[k + "k"] = await joinT(kit, T[k]);
      S[k + "j"] = await joinT(jun, T[k]);
      await sendW(kit, S[k + "k"]);
      await sendW(jun, S[k + "j"]);
    }
    // Harbor Run: sent 14 days ago, deadlines 8 days ago → its pieces close in 7 days. Sky Lab: sent 18 days ago, deadlines 12 days ago → close in 3 days.
    placeTest(T.A, 20, 9);
    placeTest(T.B, 25, 13);
    for (const [k, sent, due, joined] of [["A", 14, 8, 16], ["B", 18, 12, 22]]) for (const w of ["k", "j"]) {
      placeTester(S[k + w], joined, due);
      placeSent(subOf(S[k + w]), sent);
    }
    await sweepLong(() => lines(kit.uid, "Charge or let go:%") > 0 && lines(vera.uid, "Pay now:%") > 0 && lines(vera.uid, "Closing soon:%") > 0, "the daily money lines");
    console.log("   lines:", sql(`select string_agg(text, ' || ') from "Notification" where "userId" in ('${vera.uid}', '${kit.uid}') and ("reminderKey" like 'paynow%' or "reminderKey" like 'chargeday%' or "reminderKey" like 'closesoon%')`));
    // §32 Two charges while Vera is away that her bank wants confirmed: Kit charges on both tests → one line for both.
    setCard(vera.email, "pm_card_authenticationRequired");
    await chargeApi(kit, S.Ak, { submissionId: subOf(S.Ak), tickedCents: 1000 });
    await chargeApi(kit, S.Bk, { submissionId: subOf(S.Bk), tickedCents: 1200 });
    // ----- The developer's bell (before the hold) -----
    await bellPage(vera);
    console.log("   Vera's entries:", JSON.stringify(await entries(vera)));
    const rt = await stackTitle(vera, "Ratings to give");
    const payNow = await say(lineLoc(vera, "Pay now:")), soon = await say(lineLoc(vera, "Closing soon:"));
    const bank0 = await say(stack(vera, "Payments and holds").locator(":scope > button span span").nth(1));
    await shot(vera, "bell-01-dev-list", `The developer's bell | Vera's list, lines from several tests stacked by kind: “${rt}”, the one-a-day “${payNow}” and “${soon}”, and “Payments and holds” led by the one bank line “${bank0}”; Kit's four applications to Approved-only tests stay single lines on the developer's side.`, bellList(vera));
    await expand(vera, "Ratings to give");
    const rtLines = (await stack(vera, "Ratings to give").locator("[data-bell-line]").allInnerTexts()).map((s) => s.trim());
    await shot(vera, "bell-02-dev-ratings", `Ratings to give (§21) | One entry across two tests: ${rtLines.map((l) => `“${l}”`).join(", ")}, each opening the dashboard's Ratings to give box.`, stack(vera, "Ratings to give"));

    // ----- A stack's lines each open their own place (video) -----
    {
      const D = slowOk(await rec(V, vera));
      const W = [];
      /** On the bell page: run `act` (expand, then click a line) and keep from just before it; then keep from the arrival on its place for 3 seconds. */
      const visit = async (act, sel) => {
        await bellPage(D);
        const a = Date.now();
        await pause(D, 1200);
        await act();
        W.push([a, Date.now() + 800]);
        await D.waitForSelector(sel, { timeout: 90000 }).catch(() => {});
        const b = Date.now();
        await pause(D, 3000);
        W.push([b - 300, Date.now()]);
      };
      await visit(async () => { await expand(D, "Payments and holds"); await pause(D, 1200); await lineLoc(D, "Your bank wants you to confirm").evaluate((a) => a.click()); }, "[data-bank-top]");
      await visit(async () => { await expand(D, "Ratings to give"); await pause(D, 1200); await stack(D, "Ratings to give").locator("[data-bell-line]").first().evaluate((a) => a.click()); }, "#ratings-to-give");
      await visit(async () => { await lineLoc(D, "Pay now:").evaluate((a) => a.click()); }, "#needs-you");
      const f = await saveVideo(D, "pE1-d.webm");
      finishVideo([{ file: cutTo(D, f, W), from: 0 }], "bell-03-lines-open-video", "Each line opens its place | Vera expands “Payments and holds” and opens the bank line (the dashboard's “Your bank wants you to confirm” box), then a “Ratings to give” line (the dashboard's Ratings to give box), then the “Pay now” line (Needs you). The busy server's page loads were cut.");
    }

    // ----- The tester's bell -----
    await bellPage(kit);
    console.log("   Kit's entries:", JSON.stringify(await entries(kit)));
    const ai = await stackTitle(kit, "Applications and invites"), jn = await stackTitle(kit, "Joined"), krt = await stackTitle(kit, "Ratings to give");
    const cl = await say(lineLoc(kit, "Charge or let go:"));
    await shot(kit, "bell-05-tester-list", `The tester's bell | Kit's list: “${ai}”, “${jn}”, “${krt}” and the one-a-day “${cl}” (one line for both tests); “Payments delayed” is the tester's side of the two charges waiting for Vera's bank.`, bellList(kit));
    for (const t of ["Applications and invites", "Joined", "Ratings to give"]) await expand(kit, t);
    const aiL = (await stack(kit, "Applications and invites").locator("[data-bell-line]").allInnerTexts()).map((s) => s.trim());
    const jnL = (await stack(kit, "Joined").locator("[data-bell-line]").allInnerTexts()).map((s) => s.trim());
    await shotSpan(kit, "bell-06-tester-stacks", `Applications and invites, Joined (§23, §24) | Expanded: ${aiL.map((l) => `“${l}”`).join(", ")}; and ${jnL.map((l) => `“${l}”`).join(", ")}, each line opening its own join or session page.`, stack(kit, "Applications and invites"), stack(kit, "Joined"));
    await checkTester(kit, "Kit");

    // ----- The admin's bell -----
    await bellPage(admin);
    console.log("   admin entries:", JSON.stringify((await entries(admin)).slice(0, 8)));
    const dTitle = await stackTitle(admin, "Disputes ·"), rTitle = (await stack(admin, "Reports ·").count()) ? await stackTitle(admin, "Reports ·") : await say(lineLoc(admin, "New report:"));
    await expand(admin, "Disputes ·");
    if (await stack(admin, "Reports ·").count()) await expand(admin, "Reports ·");
    const rL = (await stack(admin, "Reports ·").locator("[data-bell-line]").allInnerTexts().catch(() => [])).map((s) => s.trim());
    const dL = (await stack(admin, "Disputes ·").locator("[data-bell-line]").allInnerTexts()).map((s) => s.trim()).filter((l) => /Vera Holt/.test(l));
    await shot(admin, "bell-07-admin", `The admin's bell (§29) | One entry per kind across tests: “${dTitle}” (${dL.map((l) => `“${l}”`).join(", ")}) and “${rTitle}”${rL.length ? ` (${rL.map((l) => `“${l}”`).join(", ")})` : ""}, each line opening its own row in the admin console.`, bellList(admin));

    // ----- §33 The team pauses one test, then a declined Pay puts Vera on a payment hold: one "Payments and holds" entry. -----
    await adminDo(admin, "pause-test", T.H);
    setCard(vera.email, "pm_card_declined");
    await post(vera, "/api/review", { action: "pay", kind: "submission", id: subOf(S.Aj), amount: "10.00", tickedCents: 1000, payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true });
    await bellPage(vera);
    const ph = await stackTitle(vera, "Payments and holds");
    await expand(vera, "Payments and holds");
    const phLines = (await stack(vera, "Payments and holds").locator("[data-bell-line]").allInnerTexts()).map((s) => s.trim());
    console.log("   Payments and holds:", JSON.stringify(phLines));
    await shot(vera, "bell-04-dev-payments-holds", `Payments and holds, across tests (§32, §33) | “${ph}”, expanded: ${phLines.slice(0, 6).map((l) => `“${l}”`).join(", ")}: the team's pause and the hold lines stack with the one bank line.`, stack(vera, "Payments and holds"));
    await bellPage(kit);
    await checkTester(kit, "Kit (after the hold)");
  }, { section: BELL, fake: true });

  // =====================================================================================================================================================
  // pE2: the bell's number (§28): entries with anything unread, not lines; read only when opened; a new line counts again; live; "9+".
  group("pE2", async () => {
    const vera = await acct(`dev+media${TS}pe2v@playtest.test`, "Vera Holt", "developer", "they");
    await subD(vera);
    const ts = [];
    for (const [i, n] of ["Kit Moreau", "Jun Abara", "Ola Brandt", "Pia Lund"].entries()) ts.push(await acct(`tester+media${TS}pe2${i}@playtest.test`, n, "tester", "they"));
    const t1 = await postT(vera, { productName: "Harbor Run", title: "Harbor Run: first 3 levels" });
    // Earlier lines (the plan's receipt) were read before: only today's joins count.
    own(`update "Notification" set "readAt" = ${U} where "userId" = '${vera.uid}' and "userId" in (select id from "User" where email = ${lit(vera.email)})`);
    for (const t of ts.slice(0, 3)) await joinT(t, t1);
    const D = await rec(V, vera);
    slowOk(D);
    await bellPage(D);
    const from = at(D);
    await pause(D, 2500);
    const c0 = await bellCount(D);
    const title = await stackTitle(D, "Harbor Run");
    console.log("   bell", c0, "|", title);
    await shotSpan(D, "bell-number-01-three-lines", `One entry, three lines | Three testers joined “Harbor Run: first 3 levels”: the stack “${title}” has 3 unread lines, and the bell's red number is ${c0}: it counts entries with anything unread, not lines (the plan's two earlier lines were already read).`, "header", "main ul.card");
    // Visiting the page again changes nothing.
    await D.reload();
    await D.waitForSelector("main ul.card");
    await pause(D, 2500);
    const c1 = await bellCount(D);
    await expand(D, "Harbor Run");
    await D.waitForSelector('header [data-bell-count="0"]', { timeout: 15000 }).catch(() => {});
    await pause(D, 1500);
    const c2 = await bellCount(D);
    await shotSpan(D, "bell-number-02-expanded", `Expanding reads it | After a reload of the Notifications page the number was still ${c1}; expanding the stack marks its 3 lines read and the number drops to ${c2} at once.`, "header", "main ul.card");
    // A new line in the read stack: the number comes back by itself (the page's ~20-second check), no navigation.
    const t0 = Date.now();
    await joinT(ts[3], t1);
    await D.waitForSelector('header [data-bell-count="1"]', { timeout: 60000 }).catch(() => console.log("   ! the number didn't come back"));
    const secs = Math.round((Date.now() - t0) / 1000);
    await pause(D, 1500);
    await shotSpan(D, "bell-number-03-live", `Live, without navigation | Pia Lund joined meanwhile: a new line in the read stack, and the bell's number went back to ${await bellCount(D)} by itself ${secs} seconds later, with the page untouched (the open list still shows the stack as read until a reload).`, "header", "main ul.card");
    await D.reload();
    await D.waitForSelector("main ul.card");
    await pause(D, 2500);
    const title2 = await stackTitle(D, "Harbor Run");
    await shot(D, "bell-number-04-unread-again", `Unread again | After a reload the stack (“${title2}”) is bold again with 1 unread line: a stack that gets a new line after being read counts again.`, stack(D, "Harbor Run"));
    finishVideo([{ file: await saveVideo(D, "pE2-d.webm"), from }], "bell-number-video", `The bell's number | Vera's Notifications page: the bell reads ${c0} for one stack of 3 unread lines; a reload leaves it at ${c1}; expanding the stack takes it to ${c2}; another tester joins and about ${secs} seconds later the number is back to 1 on its own; a reload shows the stack unread again.`);
    // "9+": one more line on nine other tests (each its own entry).
    for (let i = 2; i <= 10; i++) {
      const id = await postT(vera, { productName: `Demo ${i}`, title: `Demo ${i}: first level` });
      await joinT(ts[0], id);
    }
    await bellPage(vera);
    const n = (await entries(vera)).length;
    const aria = await vera.locator("header [data-bell-count]").first().getAttribute("aria-label");
    await shot(vera, "bell-number-05-nine-plus", `Above 9 | Ten entries with something unread (Kit Moreau joined nine more tests, plus the Harbor Run stack): the bell reads “9+” (its label: “${aria}”); the list has ${n} entries, the plan's two lines among them already read.`, "header");
  }, { section: BELL, fake: true });

  // =====================================================================================================================================================
  // pE3: batch 25: §1 confirm-by in the developer's own zone, §3 the renewal line, §2 a retried chargeback's wording, §5 one bell line for an automatic retry.
  group("pE3", async () => {
    const TZ = "Pacific/Auckland", SERVER_TZ = "America/Chicago";
    const vera = await acct(`dev+media${TS}pe3v@playtest.test`, "Vera Holt", "developer", "they");
    await subD(vera);
    own(`update "User" set "timeZone" = '${TZ}' where email = ${lit(vera.email)}`);
    const kit = await acct(`tester+media${TS}pe3k@playtest.test`, "Kit Moreau", "tester", "they");
    const jun = await acct(`tester+media${TS}pe3j@playtest.test`, "Jun Abara", "tester", "they");
    const admin = await adminA();
    const t = await postT(vera, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00" });
    const sK = await joinT(kit, t), sJ = await joinT(jun, t);
    await sendW(kit, sK);
    await sendW(jun, sJ);
    setCard(vera.email, "pm_card_authenticationRequired");
    openCharge(sK, t);
    openCharge(sJ, t);
    await chargeApi(kit, sK, { submissionId: subOf(sK), tickedCents: 1000 });
    await chargeApi(jun, sJ, { submissionId: subOf(sJ), tickedCents: 1000 });
    const payK = sql(`select id from "Payment" where "submissionId" = '${subOf(sK)}' and "actionPi" is not null order by "createdAt" desc limit 1`);
    const payJ = sql(`select id from "Payment" where "submissionId" = '${subOf(sJ)}' and "actionPi" is not null order by "createdAt" desc limit 1`);
    // The plan's renewal, due now: the card asks the bank.
    own(`update "User" set "subscriptionRenewsAt" = ${U} - interval '1 minute' where email = ${lit(vera.email)}`);
    console.log("   renew:", JSON.stringify(await hook("renew", vera.email)).slice(0, 200));
    const payR3 = sql(`select id from "Payment" where "developerId" = '${vera.uid}' and kind = 'subscription' and "actionPi" is not null order by "createdAt" desc limit 1`);
    // Confirm-by near midnight in Auckland: tonight 11:50 PM, then 12:10 AM (tomorrow there), and the renewal in 3 days at 11:55 PM.
    const byK = zoned(TZ, 0, 23, 50), byJ = new Date(byK.getTime() + 20 * 60000), byR = zoned(TZ, 3, 23, 55);
    if (byK.getTime() < Date.now() + 3600000) throw new Error("too close to midnight in Auckland for this case");
    own(`update "Payment" set "actionBy" = '${byK.toISOString()}' where id = '${payK}'`);
    own(`update "Payment" set "actionBy" = '${byJ.toISOString()}' where id = '${payJ}'`);
    if (payR3) own(`update "Payment" set "actionBy" = '${byR.toISOString()}' where id = '${payR3}'`);
    console.log(`   Auckland now ${inZone(new Date(), TZ)}; by ${inZone(byK, TZ)} / ${inZone(byJ, TZ)} / ${inZone(byR, TZ)}; server (${SERVER_TZ}) now ${inZone(new Date(), SERVER_TZ)}, by ${inZone(byK, SERVER_TZ)} / ${inZone(byJ, SERVER_TZ)}`);
    const AK = { ...V, timezoneId: TZ };
    // §1 The dashboard's box (a short recording), Payments' list and the test page.
    const D = slowOk(await rec(AK, vera));
    await openR(D, "/app", "[data-bank-top]");
    const from = at(D);
    await D.locator("[data-bank-top]").scrollIntoViewIfNeeded();
    await pause(D, 2500);
    const rows = (await D.locator("[data-bank-top-row] p").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
    console.log("   §1 rows:", rows.join(" | "));
    const red = await D.locator("[data-confirm-by=soon]").count();
    await shot(D, "b25-01-box", `§1 Confirm-by in the developer's own time zone | Vera's saved zone is Pacific/Auckland (it's ${inZone(new Date(), TZ)} there; the server's clock says ${inZone(new Date(), SERVER_TZ)}): ${rows.map((r) => `“${r}”`).join(", ")}; the ${red} under 24 hours are red. On the server's clock the first would be ${inZone(byK, SERVER_TZ)}.`, "[data-bank-top]");
    await D.locator("[data-bank-top-row]").first().hover().catch(() => {});
    await pause(D, 2500);
    finishVideo([{ file: await saveVideo(D, "pE3-box.webm"), from }], "b25-01-box-video", `§1 The dashboard box in Auckland | Vera's dashboard near midnight in Auckland: “today, 11:50 PM” and “tomorrow, 12:10 AM” in red (under 24 hours), the renewal in 3 days in grey.`);
    const P = slowOk(await same(vera, AK));
    await openR(P, "/app/payments", "[data-confirm-list]");
    const items = (await P.locator("[data-confirm-list] li").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").replace(/\s*Confirm with your bank( →)?/g, "").trim());
    await shot(P, "b25-01-payments", `§1 Payments' list, the same zone | ${items.map((s) => `“${s.slice(0, 120)}”`).join(", ")}.`, "[data-confirm-list]");
    await openR(P, `/app/tests/${t}`, `[data-bank-waiting="${payK}"]`);
    const w = P.locator(`[data-bank-waiting="${payK}"]`);
    const wl = await say(w.locator("p").first());
    await shot(P, "b25-01-test-page", `§1 The test page's “Confirm it by” | “${wl}”`, w);
    // §3 The bell line (one line for every charge waiting, batch 29 §32) opens the dashboard's box; the renewal's row opens its own Payments row, highlighted.
    await bellPage(P);
    if (await stack(P, "Payments and holds").count()) await expand(P, "Payments and holds");
    const bl = await say(lineLoc(P, "Your bank wants you to confirm"));
    const R = slowOk(await rec(AK, vera));
    await bellPage(R);
    const WR = [], q0 = Date.now();
    const ph = stack(R, "Payments and holds");
    if (await ph.count()) await expand(R, "Payments and holds");
    await pause(R, 1200);
    await lineLoc(R, "Your bank wants you to confirm").evaluate((a) => a.click());
    WR.push([q0, Date.now() + 800]);
    await R.waitForSelector("[data-bank-top]", { timeout: 90000 });
    const q1 = Date.now();
    await pause(R, 2000);
    const renewal = R.locator("[data-bank-top-row]", { hasText: "plan" }).first();
    await renewal.scrollIntoViewIfNeeded().catch(() => {});
    await pause(R, 1200);
    await renewal.locator("[data-bank-top-link]").evaluate((a) => a.click());
    WR.push([q1 - 300, Date.now() + 800]);
    await R.waitForURL(/\/app\/payments/, { timeout: 90000 });
    const q2 = Date.now();
    await pause(R, 1200);
    const target = R.locator(`[id="bank-${payR3}"]`).first();
    const tgt = (await target.count()) ? target : R.locator(`[data-confirm-item="${payR3}"]`).first();
    const tl = (await say(tgt)).replace(/\s*Confirm with your bank( →)?/g, "");
    await shot(R, "b25-03-renewal-row", `§3 The renewal opens its own row | From the bell line “${bl}” (batch 29 §32: one line for every waiting charge, opening the dashboard's box), the renewal's “Confirm with your bank →” opens Payments at its own row, highlighted: “${tl.slice(0, 160)}”.`, tgt);
    await pause(R, 2500);
    WR.push([q2 - 300, Date.now()]);
    const fR = await saveVideo(R, "pE3-renewal.webm");
    finishVideo([{ file: cutTo(R, fR, WR), from: 0 }], "b25-03-renewal-video", "§3 Bell line → dashboard box → the renewal's row | The bank line in the bell opens the dashboard's “Your bank wants you to confirm” box; the plan's row opens Payments at the renewal, highlighted. The busy server's page loads were cut.");
    await P.context().close().catch(() => {});

    // §2 A retried chargeback: a chargeback opened after Mara reserved what was owed is charged again right after the team's Approve; her bank asks.
    const mara = await acct(`dev+media${TS}pe3m@playtest.test`, "Mara Quinn", "developer", "they");
    await subD(mara);
    const t2 = await postT(mara, { productName: "Sky Lab", title: "Sky Lab: tutorial", writtenCents: "12.00", categories: ["Education"] });
    const k2 = await joinT(kit, t2), j2 = await joinT(jun, t2);
    await sendW(kit, k2);
    await sendW(jun, j2);
    await payR(mara, subOf(k2), "12.00");
    await payR(mara, subOf(j2), "12.00");
    await chargeback(subOf(k2));
    const M = slowOk(await same(mara));
    await go3(M, "/app/payments");
    await M.waitForSelector("[data-chargeback-steps]");
    await verifyCard(M);
    await reserve(M);
    await chargeback(subOf(j2)); // (after the reservation)
    setCard(mara.email, "pm_card_authenticationRequired");
    await adminDo(admin, "approve-chargeback", mara.uid);
    await new Promise((r) => setTimeout(r, 4000));
    console.log("   §2 payments:", sql(`select string_agg(kind || ':' || status || ':' || coalesce("actionBy"::text, '-'), ', ') from "Payment" where "developerId" = '${mara.uid}'`));
    await openR(M, "/app", "[data-bank-top]");
    const row2 = M.locator("[data-bank-top-row]").first();
    const r2 = await say(row2.locator("p"));
    await shot(M, "b25-02-retried-chargeback", `§2 One wording for a retried chargeback | Jun's payment was reversed after Mara reserved what was owed; after the team's Approve it was charged again and the bank asked: the dashboard reads “${r2}”, as the test page does.`, "[data-bank-top]");
    await M.context().close().catch(() => {});

    // §5 One bell line for an automatic retry: one item (Ines) and several (Otto).
    const ines = await acct(`dev+media${TS}pe3i@playtest.test`, "Ines Varga", "developer", "they");
    await subD(ines);
    const t3 = await postT(ines, { productName: "Tide Tracker", title: "Tide Tracker: widgets", writtenCents: "10.00", categories: ["Productivity"] });
    const k3 = await joinT(kit, t3);
    await sendW(kit, k3);
    setCard(ines.email, "pm_card_declined");
    await post(ines, "/api/review", { action: "pay", kind: "submission", id: subOf(k3), amount: "10.00", tickedCents: 1000, payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true });
    setCard(ines.email, "pm_card_visa");
    console.log("   §5 retry (one):", JSON.stringify(await hook("retry", ines.email)));
    const otto = await acct(`dev+media${TS}pe3o@playtest.test`, "Otto Brenner", "developer", "they");
    await subD(otto);
    const t4 = await postT(otto, { productName: "Pocket Chef", title: "Pocket Chef: recipe search", writtenCents: "10.00", categories: ["Shopping"] });
    const k4 = await joinT(kit, t4), j4 = await joinT(jun, t4);
    await sendW(kit, k4);
    await sendW(jun, j4);
    setCard(otto.email, "pm_card_declined");
    await post(otto, "/api/review", { action: "pay", kind: "submission", id: subOf(k4), amount: "10.00", tickedCents: 1000, payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true });
    openCharge(j4, t4);
    await chargeApi(jun, j4, { submissionId: subOf(j4), tickedCents: 1000 }); // (added to what Otto owes during the hold)
    setCard(otto.email, "pm_card_visa");
    console.log("   §5 retry (several):", JSON.stringify(await hook("retry", otto.email)));
    for (const [d, name, n] of [[ines, "b25-05-retry-one", "one item"], [otto, "b25-05-retry-several", "two items"]]) {
      await bellPage(d);
      if (await stack(d, "Payments and holds").count()) await expand(d, "Payments and holds");
      const all = (await d.locator("[data-bell-line]").allInnerTexts()).map((s) => s.trim());
      const retry = all.filter((l) => /^We charged your card/.test(l));
      const receipts = all.filter((l) => /^Receipt:/.test(l) && /owed/.test(l));
      console.log(`   §5 ${n}:`, JSON.stringify(all));
      const target5 = (await stack(d, "Payments and holds").count()) ? stack(d, "Payments and holds") : bellList(d);
      await shot(d, name, `§5 One bell line for an automatic retry (${n}) | ${d.name}'s daily retry went through: one line, “${retry[0] || "(none)"}”, in “Payments and holds”${receipts.length ? `; App bug: also ${receipts.map((r) => `“${r}”`).join(", ")}` : "; no second receipt line for the same money"}.`, target5);
    }
  }, { section: B25, fake: true });

  // =====================================================================================================================================================
  // pE4: batch 28 §8 (a Charge after the reservation never blocks Approve) and the re-recorded b23-06-reserve-video.
  group("pE4", async () => {
    const vera = await acct(`dev+media${TS}pe4v@playtest.test`, "Vera Holt", "developer", "they");
    const kit = await acct(`tester+media${TS}pe4k@playtest.test`, "Kit Moreau", "tester", "they");
    const jun = await acct(`tester+media${TS}pe4j@playtest.test`, "Jun Abara", "tester", "they");
    const admin = await adminA();
    await subD(vera);
    const t = await postT(vera, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], writtenCents: "12.00" });
    const sK = await joinT(kit, t);
    await sendW(kit, sK);
    await payR(vera, subOf(sK), "12.00");
    // Jun's answers on a second test, not paid in time: Charge opens for them.
    const t2 = await postT(vera, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00" });
    const sJ = await joinT(jun, t2);
    await sendW(jun, sJ);
    openCharge(sJ, t2);
    await chargeback(subOf(sK));
    const D = slowOk(await rec(V, vera)), A = slowOk(await rec(V, admin));
    await go3(D, "/app/payments");
    await D.waitForSelector("[data-chargeback-steps]");
    const W = [], w0 = Date.now();
    await pause(D, 1200);
    await verifyCard(D);
    await reserve(D);
    await pause(D, 2000);
    const reservedText = await say(D.locator("text=/Reserved \\$/").first());
    await shot(D, "b28-08-01-reserved", `§8 Reserved | During the chargeback hold Vera verified a card and pressed Pay what you owe: “${reservedText}”`, D.locator("[data-chargeback-paid], #owed").first());
    W.push([w0, Date.now() + 500]);
    // Jun charges meanwhile: added to what's owed after the reservation.
    const w1 = Date.now();
    await chargeApi(jun, sJ, { submissionId: subOf(sJ), tickedCents: 1000 });
    await D.reload();
    await D.waitForSelector("#owed");
    await pause(D, 2500);
    const resLine = await say(D.locator("[data-reserved]").first());
    const disabled = await D.locator("#owed button", { hasText: /Pay what you owe/ }).first().isDisabled().catch(() => null);
    console.log("   §8 Payments:", resLine, "| Pay what you owe disabled:", disabled);
    await shot(D, "b28-08-02-added-since", `§8 Added since, charged after | Jun charged for their answers after the reservation: Payments says “${resLine}” and Pay what you owe is ${disabled ? "disabled" : "NOT disabled (App bug)"}.`, "#owed");
    W.push([w1, Date.now() + 500]);
    const w2 = Date.now();
    let row = await cbRow(A, vera.uid);
    const rowText = await say(row);
    const m = /Chargeback hold: .*?\(charged after the hold lifts\)\)/.exec(rowText);
    console.log("   §8 admin row:", rowText.slice(0, 400));
    await shot(A, "b28-08-03-admin-row", `§8 The team's row | Vera's chargeback row before Approve: “${m ? m[0] : rowText.slice(0, 140)}” with Approve.`, row);
    await row.locator("button", { hasText: /^Approve$/ }).click();
    const res = row.locator(".err, .ok").first();
    await res.waitFor({ timeout: 30000 }).catch(() => {});
    await A.waitForSelector("text=Done.", { timeout: 20000 }).catch(() => {});
    await pause(A, 2000);
    const resText = await say(A.locator(".err, .ok").first());
    console.log("   §8 Approve:", resText);
    W.push([w2, Date.now() + 500]);
    await new Promise((r) => setTimeout(r, 4000));
    console.log("   §8 payments:", sql(`select string_agg(kind || ':' || status || ':' || "amountCents", ', ') from "Payment" where "developerId" = '${vera.uid}'`), "| hold:", sql(`select coalesce("holdReason", 'none') || ' ' || coalesce("holdStartedAt"::text, 'lifted') from "User" where id = '${vera.uid}'`));
    const w3 = Date.now();
    await go3(D, "/app/notifications");
    await D.waitForSelector("main ul.card");
    await pause(D, 1500);
    for (const b of await D.locator("[data-bell-stack] > button[aria-expanded=false]").all()) await b.click().catch(() => {});
    await pause(D, 2500);
    const rcpt = await say(D.locator("[data-bell-line]", { hasText: "Receipt: you paid" }).first());
    const lifted = await say(D.locator("[data-bell-line]", { hasText: "The team approved lifting your hold" }).first());
    W.push([w3, Date.now()]);
    const fD = await saveVideo(D, "pE4-d.webm"), fA = await saveVideo(A, "pE4-a.webm");
    sec(B23);
    finishVideo([{ file: fD, from: 0 }, { file: fA, from: 0 }], "b23-06-reserve-video",
      "§6 Reserve, then Approve (batch 28 §8) | The developer (left) verifies a card and reserves what's owed; the tester charges meanwhile and Payments says the added amount will be charged right after; the team's Approve (right) still goes through, the hold lifts and the added amount is charged after the lift (its receipt in the bell). The busy server's waits between the steps were cut.");
    sec(B28);
    await openBell(vera);
    const bellTarget = vera.locator("[data-bell-stack], main ul.card > li", { hasText: "Receipt: you paid" }).first();
    await shot(vera, "b28-08-04-receipt", `§8 Charged right after the lift | Approve went through${resText ? ` (“${resText}”)` : ""}: “${lifted}” and the added amount's own receipt: “${rcpt}”.`, (await bellTarget.count()) ? bellTarget : bellList(vera));
    await openBell(jun);
    const junPaid = await say(jun.locator("[data-bell-line]", { hasText: /paid you|You were paid|charge went through|arrived/ }).first());
    await checkTester(jun, "Jun");
    await shot(jun, "b28-08-05-tester-paid", `§8 The tester is paid | Jun's bell: “${junPaid}”; nothing about the developer's hold or chargeback.`, bellList(jun));
  }, { section: B28, fake: true });

  // =====================================================================================================================================================
  // pE5: batch 28 §18: with email Off the developer still gets the evening "Your Playtest payment updates" email.
  group("pE5", async () => {
    const vera = await acct(`dev+media${TS}pe5v@playtest.test`, "Vera Holt", "developer", "they");
    const kit = await acct(`tester+media${TS}pe5k@playtest.test`, "Kit Moreau", "tester", "they");
    await subD(vera);
    await again(() => setEmail(vera, "off"), "email off");
    const t = await postT(vera, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00" });
    const s = await joinT(kit, t);
    await sendW(kit, s);
    await payR(vera, subOf(s), "10.00");
    await bellPage(vera);
    await unfold(vera, "[data-payment-emails]");
    await pause(vera, 500);
    const how = vera.locator("main details.card", { has: vera.locator("[data-payment-emails]") }).first();
    const howText = (await how.count()) ? await say(how) : "";
    console.log("   §18 settings:", howText.slice(0, 300));
    if (await how.count()) await shot(vera, "b28-18-01-setting", `§18 Email Off | Vera's email setting is Off; the Notifications page says: “Payment updates are always emailed the same evening.”`, how);
    else console.log("   ! §18 no 'Payment updates are always emailed' text on the Notifications page");
    console.log("   §18 summaries:", JSON.stringify(await hook("summaries", vera.email)).slice(0, 200));
    const subjects = sql(`select string_agg(subject, ' | ' order by "createdAt") from "OutboxEmail" where "to" = ${lit(vera.email)}`);
    console.log("   §18 outbox:", subjects);
    const row = outboxRow(vera.email, "Your Playtest payment updates%");
    const P = await ctx(V);
    await mailShot(P, row, "b28-18-02-payment-email", `§18 The evening payment email with email Off | “${row ? row.subject : "(none)"}” went to Vera that evening although their email is Off, with ${row ? row.text.split(String.fromCharCode(10)).filter((l) => l.startsWith("• ")).map((l) => `“${l.slice(2).replace(/ https?:\/\/\S+$/, "")}”`).join(", ") : ""}; no other summary email (Vera's outbox: ${subjects.split(" | ").map((x) => `“${x}”`).join(", ")}).`);
  }, { section: B28, fake: true });
}
