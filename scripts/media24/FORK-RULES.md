# Rules for the parallel recording forks (Oct 29 media run)

- Your groups go in ONE file: scratchpad/media24/parts/<part>.js (plain code, no requires needed: it is pasted into scripts/media.cjs just before
  "// ---------- the report manifest ----------", so every harness helper is in scope: account, postTest, join, sendWritten, shot, shotSpan, shotFull, rec, at,
  pause, saveVideo, finishVideo, sec, sql, own, lit, ok, post, adminAccount, adminDo, bookCall, apiPay, payPiece, openCharge, chargeUI, bankPopup, setCard, webhook,
  hook, subOf, open, waitPoll, waitLive, waitGone, waitPulse, openBell, bellList, subscribeDev, fillPost, saveBtn, field, typeSlow, stopTest, rateDev, sessionDo,
  disputeOf, pressConfirm, unfold, sweepUntil, tookPlace, piece, etc.).
- Wrap the WHOLE part in one block `{ ... }` and declare your helpers with `const x = async (...) => {}` (no top-level `function` declarations), so parts never
  clash. Section names: `const` strings inside the block.
- Never edit scripts/media.cjs, docs/media/captions.json or report-manifest.json by hand. Build a runnable copy with
  `node <scratch>/media24/assemble.cjs <part>` (writes scripts/media-run-<part>.cjs; re-run it after each edit of your part), then from C:/Users/march/Projects/playtest-lite:
  `BROWSER_CHANNEL=chrome BASE=http://localhost:3450 MEDIA_DB=playtest_lite_media ONLY=<your groups> SIZES=desktop node scripts/media-run-<part>.cjs`
  (Edge doesn't start on this machine: always BROWSER_CHANNEL=chrome). Iterate at desktop, then run SIZES=desktop,phone for the final files. Every group is
  `{ section: "<section>", fake: true }` (all on the 3450 media server).
- Only the 3450 server on playtest_lite_media. Never port 3400 or the playtest_lite database. Never stop or restart the server (the parent does). Never kill
  processes other than a node run you started (by its PID). Never POST /api/health/alert. While the file scratchpad/media24/OUTAGE-IN-PROGRESS exists the server
  is deliberately stopped for the outage recording: don't run anything against it until the file is gone (use the time to read code and write groups).
- Fresh throwaway accounts only, emails like `dev+media${TS}<yourgroup><x>@playtest.test` / `tester+media${TS}...` / admins via adminAccount(). Use `own()` for
  SQL that changes rows (it checks the rows are this run's). Never print the test password or .env values. The fake Stripe only. No real emails.
- Captions: "§N Short title | one plain-English sentence" quoting the screen's exact lines, "they" for people (never he/she/his/her). LOOK at every screenshot
  (Read the PNG) before you settle its caption; fix the caption to what is really on screen. Videos: a short video wherever something happens over time.
- Files: names start with your batch prefix (b20-.., b21-.., b22-.., b23-.., b24-.., blk-.., ct-..). Both sizes (desktop and -phone).
- Videos: after your final run, check yours with `node <scratch>/media24/framecheck.cjs C:/Users/march/Projects/playtest-lite/docs/media <prefix>`; every one
  must print "ok" (no frame-size change). The harness now never resizes a recording page (screenshots on a recording page are cut from the screen, or taken
  from a separate page); don't call page.screenshot with fullPage yourself.
- App bugs: don't fix app code. Record what happens, note it (with the file names that show it). A tester's screen that says "hold", "suspended", "failed" or
  "chargeback" about a developer is a bug to note.
- When done: delete your scripts/media-run-<part>.cjs copy, leave parts/<part>.js final, and hand back: your group ids, file counts per section, every
  file name with its caption, app bugs seen (files), and what you couldn't record and why. Don't commit.
