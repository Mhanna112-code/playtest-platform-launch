const fs = require("fs");
const F = __dirname + "/parts/b2122.js";
let s = fs.readFileSync(F, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing " + a.slice(0, 70)); s = s.split(a).join(b); };
rep(`    const fromD = at(D), fromT = at(T);
    for (let i = 0; i < 4; i++) {
      await pause(D, 4000);
      const st = [await D.locator("[data-call-status]").innerText().catch(() => "?"), await T.locator("[data-call-status]").innerText().catch(() => "?")];
      console.log("   room status:", st.join(" / "));
      if (st.every((x) => /^Connected/.test(x))) break;
    }
    const okD = await connected(D), okT = await connected(T);
    if (!okD || !okT) console.log("   ! call room: not connected", await D.locator("[data-call-status]").innerText().catch(() => "?"), "/", await T.locator("[data-call-status]").innerText().catch(() => "?"));
    return { D, T, fromD, fromT };
  };`, `    await bothConnected(D, T, 120000);
    // (the video starts here, a few seconds before both are connected for good: the minutes the busy machine took to start them are left out)
    const fromD = Math.max(0, at(D) - 4), fromT = Math.max(0, at(T) - 4);
    return { D, T, fromD, fromT };
  };
  /** Waits (up to \`ms\`) until both pages say "Connected" (the busy media server can take a while); logs the states. */
  const bothConnected = async (D, T, ms = 60000) => {
    const end = Date.now() + ms;
    let st = [];
    while (Date.now() < end) {
      st = [await D.locator("[data-call-status]").innerText().catch(() => "?"), await T.locator("[data-call-status]").innerText().catch(() => "?")];
      if (st.every((x) => /^Connected/.test(x))) return true;
      await pause(D, 2000);
    }
    console.log("   ! call room: not both connected:", st.join(" / "));
    return false;
  };
  /** What each tile shows: the note over a tile without a picture ("No camera", "Camera off", …) or "" when a picture shows. */
  const tiles = (P) => P.evaluate(() => {
    const t = [...document.querySelectorAll("[data-call-room] .relative.overflow-hidden")];
    const note = (el) => (el ? (el.querySelector(".absolute.inset-0 span:last-child")?.textContent || "") : "?");
    return { other: note(t[0]), mine: note(t[1]), status: (document.querySelector("[data-call-status]")?.textContent || "").split(" · ")[0] };
  });
  const tileText = (n) => (n ? \`shows the initial with “\${n}”\` : "shows the camera picture (Chrome's test pattern)");`);
rep(`    await pause(D, 2500);
    await cshot(D, "b21-01-connected-dev", "§1 Connected | Nora's call page: “Call with Ana Silva”, Ana's camera (Chrome's test picture) large and Nora's own small, “Connected · measured so far: 0 min”, with Mute, Camera off, Share screen and Leave.", "main");
    await cshot(T, "b21-01-connected-tester", "§1 The tester's side | Ana sees the same room from their side: “Call with Nora Lane”, both pictures, and “Connected”.", "main");`,
`    await pause(D, 2500);
    let d0 = await tiles(D), t0 = await tiles(T);
    console.log("   tiles:", JSON.stringify(d0), JSON.stringify(t0));
    const noCam = d0.mine === "No camera" || t0.mine === "No camera" ? " (tonight the test browsers' fake camera didn't start on the busy machine, so a tile says “No camera”; sound and screen share still go through)" : "";
    await cshot(D, "b21-01-connected-dev", \`§1 Connected | Nora's call page: “Call with Ana Silva”, Ana's large tile and Nora's own small one (“You”), “\${d0.status} · measured so far: …”, with Mute, Camera off, Share screen and Leave\${noCam}.\`, "main");
    await cshot(T, "b21-01-connected-tester", \`§1 The tester's side | Ana's page: “Call with Nora Lane”, Nora's tile large and their own small, and “\${t0.status}”.\`, "main");`);
rep(`    await pause(D, 4000);
    await cshot(D, "b21-01-muted-camera-off-dev", "§1 Mute and camera off | Nora pressed Mute (the button reads Unmute and their own tile shows the crossed microphone); Ana turned their camera off, so Nora sees Ana's initial with “Camera off”.", "main");
    await cshot(T, "b21-01-muted-camera-off-tester", "§1 What Ana sees | Nora's name tag carries the crossed microphone (muted); Ana's own tile reads “Camera off”, and the button reads Camera on.", "main");`,
`    await pause(D, 3000);
    await bothConnected(D, T, 30000);
    d0 = await tiles(D); t0 = await tiles(T);
    await cshot(D, "b21-01-muted-camera-off-dev", \`§1 Mute and camera off | Nora pressed Mute: the button reads Unmute and their own “You” tag carries the crossed microphone; Ana pressed Camera off, and Ana's tile on Nora's page \${tileText(d0.other)}.\`, "main");
    await cshot(T, "b21-01-muted-camera-off-tester", \`§1 What Ana sees | Nora's name tag carries the crossed microphone (muted); Ana's button now reads Camera on and their own tile \${tileText(t0.mine)}.\`, "main");`);
rep(`      await cshot(D, "b21-01-share-dev", "§1 Share screen | Nora shares their screen: their tile reads “You're sharing your screen”.", "main");
      await cshot(T, "b21-01-share-tester", "§1 Ana sees the shared screen | Nora's picture is the shared screen, marked “Sharing their screen”.", "main");`,
`      await bothConnected(D, T, 30000);
      await pause(T, 2000);
      await cshot(D, "b21-01-share-dev", "§1 Share screen | Nora shares their screen (the test browser's fake screen, a green test pattern): their own tile shows it with “You're sharing your screen”.", "main");
      await cshot(T, "b21-01-share-tester", "§1 Ana sees the shared screen | Nora's large tile is the shared screen, marked “Sharing their screen”.", "main");`);
rep(`    await cshot(D, "b21-02-warning-dev", "§2 Two minutes before the end | 150% of the 10 booked minutes is near, so the room says “This call ends at <time>.” above the pictures.", "main");
    await cshot(T, "b21-02-warning-tester", "§2 The same warning for Ana | “This call ends at <time>.”", "[data-call-warn]");`,
`    const wl = await D.locator("[data-call-warn]").innerText().catch(() => "This call ends at <time>.");
    await cshot(D, "b21-02-warning-dev", \`§2 Two minutes before the end | The call was booked for 10 minutes (paid up to 15) and both have been connected about 13 (the recording skips ahead): the room says “\${wl}” above the pictures.\`, "main");
    await cshot(T, "b21-02-warning-tester", \`§2 The same warning for Ana | “\${await T.locator("[data-call-warn]").innerText().catch(() => wl)}”\`, "[data-call-warn]");`);
rep(`"§1 and §2 A call in the app | Nora (left) and Ana (right) connect with their cameras, Nora mutes and Ana turns their camera off and on again, Nora tries Share screen, then the warning “This call ends at <time>.” shows and both pages end the call at 150% (the clock is moved on for the recording).");`,
`"§1 and §2 A call in the app | Nora (left) and Ana (right) are connected; Nora mutes and Ana presses Camera off and on again, Nora shares their screen, then the warning “This call ends at <time>.” shows and both pages end the call at 150% of the booked time (the clock is moved on for the recording).");`);
// endCase: start the video once connected (room() does), nothing else to change.
fs.writeFileSync(F, s);
console.log("ok");
