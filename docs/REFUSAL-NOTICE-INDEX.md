# Refusal wording and source index

Companion to [Stop-once notices](STOP-ONCE-NOTICES.md). Code snapshot `6b8a1077` on `codex/reminder-audit`.

Search for the button handler, error code, or words visible on screen. Each row identifies the handler and its nearest source condition. Backticked text is the message or message template. Template expressions insert the actual name, time, amount, or other context. In some cases the row points to a formatter or underlying response instead of a fixed sentence. The actual UI may prepend the button name or render the message beside a field. See the companion for the exact display rules.

This source index covers explicit HTTP-error messages and selected client notices. Some rows share the same message across multiple handlers. A few technical responses also appear in the index because they come from the same response machinery. The adjacent source links show the rest of the eligibility checks and which API route or UI displays the line.

## Server refusals

### `src/app/api/account/alerts/add/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` bad_alert ``  |  `` !ALERT_TYPES.some((a) => a.key === key) ``  |  `` That update type can't be turned off. ``  | [app/api/account/alerts/add/route.ts:12](../src/app/api/account/alerts/add/route.ts#L12) |

### `src/app/api/account/alerts/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST → bad ``  ·  `` bad_alert ``  | See handler |  `` That update type can't be turned off. ``  | [app/api/account/alerts/route.ts:14](../src/app/api/account/alerts/route.ts#L14) |

### `src/app/api/account/delete/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` confirm ``  |  `` b.confirmed !== true ``  |  `` Confirm that you want to delete your account. ``  | [app/api/account/delete/route.ts:12](../src/app/api/account/delete/route.ts#L12) |

### `src/app/api/account/notify/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` bad_pref ``  |  `` !emailPref ``  |  `` Choose how often to be emailed. ``  | [app/api/account/notify/route.ts:15](../src/app/api/account/notify/route.ts#L15) |

### `src/app/api/account/side/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` admin_only ``  |  `` isAdmin(u) ``  |  `` An admin account is only for the admin console. To post or test, use a separate account. ``  · [lib/rules.ts:1342](../src/lib/rules.ts#L1342) | [app/api/account/side/route.ts:12](../src/app/api/account/side/route.ts#L12) |
|  `` POST ``  ·  `` bad_side ``  |  `` !side ``  |  `` Choose developer or tester. ``  | [app/api/account/side/route.ts:15](../src/app/api/account/side/route.ts#L15) |
|  `` POST ``  ·  `` no_side ``  |  `` !has && b.add !== true ``  |  `` Your account doesn't have that side yet. ``  | [app/api/account/side/route.ts:17](../src/app/api/account/side/route.ts#L17) |

### `src/app/api/account/tester-alerts/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` bad_alerts ``  |  `` want === null ``  |  `` Choose On or Off. ``  | [app/api/account/tester-alerts/route.ts:13](../src/app/api/account/tester-alerts/route.ts#L13) |

### `src/app/api/account/timezone/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` bad_zone ``  |  `` !tz ``  |  `` That time zone isn't known. ``  | [app/api/account/timezone/route.ts:11](../src/app/api/account/timezone/route.ts#L11) |

### `src/app/api/admin/[action]/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` teamCloseScope ``  ·  `` not_found ``  |  `` !id ``  |  `` That account or test doesn't exist. ``  | [app/api/admin/[action]/route.ts:18](../src/app/api/admin/%5Baction%5D/route.ts#L18) |
|  `` POST ``  ·  `` suspended ``  |  `` adminAccount(u) && !isAdmin(u) ``  |  `` Your account is paused. ``  · [lib/server/session.ts:82](../src/lib/server/session.ts#L82) | [app/api/admin/[action]/route.ts:28](../src/app/api/admin/%5Baction%5D/route.ts#L28) |
|  `` POST ``  ·  `` not_admin ``  |  `` !isAdmin(u) ``  |  `` Only admins can do that. ``  | [app/api/admin/[action]/route.ts:29](../src/app/api/admin/%5Baction%5D/route.ts#L29) |
|  `` run ``  ·  `` not_found ``  |  `` case "contact-replied" → done.count !== 1 → !m ``  |  `` That message doesn't exist. ``  | [app/api/admin/[action]/route.ts:52](../src/app/api/admin/%5Baction%5D/route.ts#L52) |
|  `` run ``  ·  `` replied ``  |  `` case "contact-replied" → done.count !== 1 → own && m.repliedAt ``  |  `` `You already ${what}${where === "other" ? " in another tab" : ""} at ${whenText(at)}.` ``  · [lib/server/adminRace.ts:95](../src/lib/server/adminRace.ts#L95) | [app/api/admin/[action]/route.ts:55](../src/app/api/admin/%5Baction%5D/route.ts#L55) |
|  `` run ``  ·  `` replied ``  |  `` case "contact-replied" → done.count !== 1 ``  |  `` `${by?.email ?? "An admin (deleted)"} already marked this replied${m.repliedAt ? ` at ${fmtTime(m.repliedAt)}` : ""}.` ``  | [app/api/admin/[action]/route.ts:57](../src/app/api/admin/%5Baction%5D/route.ts#L57) |
|  `` run ``  ·  `` self ``  |  `` case "suspend" → id === u.id ``  |  `` You can't pause your own account. ``  | [app/api/admin/[action]/route.ts:64](../src/app/api/admin/%5Baction%5D/route.ts#L64) |
|  `` run ``  ·  `` bad_note ``  |  `` case "suspend" → note.length < 3 ``  |  `` Record why (it is kept with the suspension). ``  | [app/api/admin/[action]/route.ts:66](../src/app/api/admin/%5Baction%5D/route.ts#L66) |
|  `` run ``  ·  `` self ``  |  `` case "delete-account" → id === u.id ``  |  `` Use Settings to delete your own account. ``  | [app/api/admin/[action]/route.ts:76](../src/app/api/admin/%5Baction%5D/route.ts#L76) |
|  `` run ``  ·  `` bad_note ``  |  `` case "delete-account" → reason.length < 3 ``  |  `` Record why (it is kept with the deletion). ``  | [app/api/admin/[action]/route.ts:78](../src/app/api/admin/%5Baction%5D/route.ts#L78) |
|  `` run ``  ·  `` not_found ``  | See handler |  `` That action doesn't exist. ``  | [app/api/admin/[action]/route.ts:121](../src/app/api/admin/%5Baction%5D/route.ts#L121) |

### `src/app/api/admin/dispute/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` GET ``  ·  `` suspended ``  |  `` adminAccount(u) && !isAdmin(u) ``  |  `` Your account is paused. ``  · [lib/server/session.ts:82](../src/lib/server/session.ts#L82) | [app/api/admin/dispute/route.ts:9](../src/app/api/admin/dispute/route.ts#L9) |
|  `` GET ``  ·  `` not_admin ``  |  `` !isAdmin(u) ``  |  `` Only admins can do that. ``  | [app/api/admin/dispute/route.ts:10](../src/app/api/admin/dispute/route.ts#L10) |
|  `` GET ``  ·  `` not_found ``  |  `` !d ``  |  `` That dispute doesn't exist. ``  | [app/api/admin/dispute/route.ts:12](../src/app/api/admin/dispute/route.ts#L12) |

### `src/app/api/admin/more/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` GET ``  ·  `` suspended ``  |  `` adminAccount(u) && !isAdmin(u) ``  |  `` Your account is paused. ``  · [lib/server/session.ts:82](../src/lib/server/session.ts#L82) | [app/api/admin/more/route.ts:11](../src/app/api/admin/more/route.ts#L11) |
|  `` GET ``  ·  `` not_admin ``  |  `` !isAdmin(u) ``  |  `` Only admins can do that. ``  | [app/api/admin/more/route.ts:12](../src/app/api/admin/more/route.ts#L12) |
|  `` GET ``  ·  `` bad_list ``  |  `` !KINDS.includes(kind) ``  |  `` That list doesn't exist. ``  | [app/api/admin/more/route.ts:15](../src/app/api/admin/more/route.ts#L15) |

### `src/app/api/dev/hook/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` response ``  |  `` !/@playtest\.test$/.test(email) ``  |  `` Only throwaway …@playtest.test accounts. ``  | [app/api/dev/hook/route.ts:12](../src/app/api/dev/hook/route.ts#L12) |
|  `` POST ``  ·  `` response ``  |  `` !u ``  |  `` No such account. ``  | [app/api/dev/hook/route.ts:14](../src/app/api/dev/hook/route.ts#L14) |
|  `` POST ``  ·  `` response ``  | See handler |  `` Unknown action. ``  | [app/api/dev/hook/route.ts:18](../src/app/api/dev/hook/route.ts#L18) |

### `src/app/api/excerpts/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` bad_action ``  | See handler |  `` Unknown action. ``  | [app/api/excerpts/route.ts:15](../src/app/api/excerpts/route.ts#L15) |

### `src/app/api/health/alert/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` response ``  | See handler |  `` Send the alert as JSON or form fields. ``  | [app/api/health/alert/route.ts:16](../src/app/api/health/alert/route.ts#L16) |
|  `` POST ``  ·  `` response ``  |  `` !alert.type ``  |  `` alertType must be 1 (down) or 2 (up). ``  | [app/api/health/alert/route.ts:19](../src/app/api/health/alert/route.ts#L19) |
|  `` POST ``  ·  `` response ``  |  `` refused ``  |  `` That alert's time is more than 10 minutes from the server's clock, so it was ignored. ``  · [lib/server/outages.ts:79](../src/lib/server/outages.ts#L79)<br> ``  ``  · [lib/server/outages.ts:79](../src/lib/server/outages.ts#L79) | [app/api/health/alert/route.ts:22](../src/app/api/health/alert/route.ts#L22) |

### `src/app/api/help/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` bad_topic ``  |  `` !topic ``  |  `` Choose what it's about. ``  | [app/api/help/route.ts:26](../src/app/api/help/route.ts#L26) |
|  `` POST ``  ·  `` bad_message ``  |  `` message.length < 10 ``  |  `` Write a few words about what happened (at least 10 characters). ``  | [app/api/help/route.ts:27](../src/app/api/help/route.ts#L27) |
|  `` POST ``  ·  `` already ``  |  `` await tx.contactMessage.count({ where: { userId: u.id, topic, message, createdAt: { gt: new Date(Date.now() - SAME_MESSAGE_MS) } } }) ``  |  `` You already sent this message. ``  · [app/api/help/route.ts:17](../src/app/api/help/route.ts#L17) | [app/api/help/route.ts:32](../src/app/api/help/route.ts#L32) |
|  `` POST ``  ·  `` limit ``  |  `` today >= CONTACT_LIMIT_PER_DAY ``  |  `` `You've sent ${CONTACT_LIMIT_PER_DAY} messages today. We'll reply by email.` ``  · [lib/limits.ts:127](../src/lib/limits.ts#L127) | [app/api/help/route.ts:34](../src/app/api/help/route.ts#L34) |

### `src/app/api/invites/[id]/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` not_found ``  |  `` !inv &#124;&#124; inv.testerId !== u.id ``  |  `` That invite doesn't exist. ``  | [app/api/invites/[id]/route.ts:21](../src/app/api/invites/%5Bid%5D/route.ts#L21) |
|  `` POST ``  ·  `` invite_closed ``  |  `` inv.status === "replaced" → !fresh ``  |  `` This invite is no longer open. ``  · [lib/server/joining.ts:151](../src/lib/server/joining.ts#L151)<br> `` This test was stopped. ``  · [lib/server/joining.ts:146](../src/lib/server/joining.ts#L146)<br> `` `“${t.title}” closed to new testers on ${fmtDate(t.openUntil)}.` ``  · [lib/server/joining.ts:147](../src/lib/server/joining.ts#L147)<br> `` `“${t.title}” isn't taking new testers right now, so this invite was closed.` ``  · [lib/server/joining.ts:148](../src/lib/server/joining.ts#L148) | [app/api/invites/[id]/route.ts:25](../src/app/api/invites/%5Bid%5D/route.ts#L25) |
|  `` POST → closed ``  ·  `` invite_closed ``  |  `` status === "cancelled" ``  |  `` This invite is no longer open. ``  · [lib/server/joining.ts:151](../src/lib/server/joining.ts#L151)<br> `` This test was stopped. ``  · [lib/server/joining.ts:146](../src/lib/server/joining.ts#L146)<br> `` `“${t.title}” closed to new testers on ${fmtDate(t.openUntil)}.` ``  · [lib/server/joining.ts:147](../src/lib/server/joining.ts#L147)<br> `` `“${t.title}” isn't taking new testers right now, so this invite was closed.` ``  · [lib/server/joining.ts:148](../src/lib/server/joining.ts#L148) | [app/api/invites/[id]/route.ts:44](../src/app/api/invites/%5Bid%5D/route.ts#L44) |
|  `` POST → closed ``  ·  `` gone ``  |  `` else status === "cancelled" → status === "joined" ``  |  `` You already joined. ``  | [app/api/invites/[id]/route.ts:44](../src/app/api/invites/%5Bid%5D/route.ts#L44) |
|  `` POST → closed ``  ·  `` invite_closed ``  |  `` else status === "cancelled" → else status === "joined" ``  |  `` This invite is no longer open. ``  · [lib/server/joining.ts:151](../src/lib/server/joining.ts#L151) | [app/api/invites/[id]/route.ts:44](../src/app/api/invites/%5Bid%5D/route.ts#L44) |

### `src/app/api/live/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` GET ``  ·  `` bad_request ``  |  `` isNaN(since.getTime()) ``  |  `` This page is out of date. ``  | [app/api/live/route.ts:31](../src/app/api/live/route.ts#L31) |
|  `` GET ``  ·  `` not_found ``  |  `` kind === "session" → !c &#124;&#124; c.testerId !== u.id ``  |  `` That session doesn't exist. ``  | [app/api/live/route.ts:42](../src/app/api/live/route.ts#L42) |
|  `` GET ``  ·  `` not_found ``  |  `` else kind === "session" → else kind === "test" → else kind === "listing" → else kind === "invites" ``  |  `` Nothing to watch here. ``  | [app/api/live/route.ts:78](../src/app/api/live/route.ts#L78) |

### `src/app/api/payments/confirm-all/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` deleted ``  |  `` u.deletedAt ``  |  `` This account was deleted. ``  | [app/api/payments/confirm-all/route.ts:11](../src/app/api/payments/confirm-all/route.ts#L11) |

### `src/app/api/payments/confirm/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` deleted ``  |  `` u.deletedAt ``  |  `` This account was deleted. ``  | [app/api/payments/confirm/route.ts:14](../src/app/api/payments/confirm/route.ts#L14) |

### `src/app/api/payments/owed/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` suspended ``  |  `` u.devSuspendedAt && !u.holdStartedAt ``  |  `` Your account is suspended: your tests are paused. Contact us in Settings to appeal. ``  · [lib/server/users.ts:19](../src/lib/server/users.ts#L19) | [app/api/payments/owed/route.ts:11](../src/app/api/payments/owed/route.ts#L11) |

### `src/app/api/payments/subscription/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` deleted ``  |  `` u.deletedAt ``  |  `` This account was deleted. ``  | [app/api/payments/subscription/route.ts:16](../src/app/api/payments/subscription/route.ts#L16) |
|  `` POST ``  ·  `` bad_action ``  |  `` !["subscribe", "cancel", "keep"].includes(body.action as string) ``  |  `` That action doesn't exist. ``  | [app/api/payments/subscription/route.ts:18](../src/app/api/payments/subscription/route.ts#L18) |
|  `` POST ``  ·  `` already ``  |  `` body.action === "cancel" && on && u.subscriptionCanceling ``  |  `` Your subscription is already cancelled. ``  | [app/api/payments/subscription/route.ts:21](../src/app/api/payments/subscription/route.ts#L21) |
|  `` POST ``  ·  `` already ``  |  `` body.action !== "cancel" && on && !u.subscriptionCanceling ``  |  `` You're already subscribed. ``  | [app/api/payments/subscription/route.ts:22](../src/app/api/payments/subscription/route.ts#L22) |

### `src/app/api/payments/verify-card/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` payments_off ``  |  `` paymentsOff() ``  |  `` Payments are switched off right now. Try again later. ``  · [lib/server/stripe.ts:183](../src/lib/server/stripe.ts#L183) | [app/api/payments/verify-card/route.ts:37](../src/app/api/payments/verify-card/route.ts#L37) |

### `src/app/api/pulse/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` GET ``  ·  `` bad_request ``  |  `` fresh → v === null ``  |  `` Unknown page. ``  | [app/api/pulse/route.ts:24](../src/app/api/pulse/route.ts#L24) |
|  `` GET ``  ·  `` not_admin ``  |  `` adminPerson &#124;&#124; q.get("adminConsole") → !isAdmin(u) ``  |  `` Only admins can do that. ``  | [app/api/pulse/route.ts:41](../src/app/api/pulse/route.ts#L41) |
|  `` GET ``  ·  `` not_found ``  |  `` inviteTest → !t &#124;&#124; t.developerId !== u.id ``  |  `` Not found. ``  | [app/api/pulse/route.ts:91](../src/app/api/pulse/route.ts#L91) |
|  `` GET ``  ·  `` not_found ``  |  `` sessionId → !c &#124;&#124; c.testerId !== u.id ``  |  `` Not found. ``  | [app/api/pulse/route.ts:133](../src/app/api/pulse/route.ts#L133) |
|  `` GET ``  ·  `` not_found ``  |  `` !t &#124;&#124; (!sessionId && t.developerId !== u.id) ``  |  `` Not found. ``  | [app/api/pulse/route.ts:138](../src/app/api/pulse/route.ts#L138) |

### `src/app/api/recordings/[id]/upload/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` PUT ``  ·  `` not_found ``  |  `` r2On() ``  |  `` Not found. ``  | [app/api/recordings/[id]/upload/route.ts:9](../src/app/api/recordings/%5Bid%5D/upload/route.ts#L9) |
|  `` PUT ``  ·  `` not_found ``  |  `` !rec &#124;&#124; rec.contract.testerId !== u.id ``  |  `` That upload doesn't exist. ``  | [app/api/recordings/[id]/upload/route.ts:13](../src/app/api/recordings/%5Bid%5D/upload/route.ts#L13) |
|  `` PUT ``  ·  `` done ``  |  `` rec.uploadedAt ``  |  `` This file was already uploaded. ``  | [app/api/recordings/[id]/upload/route.ts:14](../src/app/api/recordings/%5Bid%5D/upload/route.ts#L14) |

### `src/app/api/sessions/[id]/[action]/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` finalRefusal ``  ·  `` gone ``  |  `` action === "terms" ``  |  `` Your part on this test has ended, so these terms no longer apply. ``  · [lib/server/terms.ts:57](../src/lib/server/terms.ts#L57) | [app/api/sessions/[id]/[action]/route.ts:46](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L46) |
|  `` finalRefusal ``  ·  `` call_cancelled ``  |  `` workOver(c) → action === "cancel-call" &#124;&#124; action === "cancel-set" ``  |  `` This call was cancelled when the test stopped. ``  · [lib/rules.ts:1840](../src/lib/rules.ts#L1840) | [app/api/sessions/[id]/[action]/route.ts:54](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L54) |
|  `` finalRefusal ``  ·  `` work_over ``  |  `` workOver(c) ``  |  `` `${overHalf(c, devName, fmt)}, so your ${press} didn't go through. Work you sent is still reviewed.` ``  · [lib/rules.ts:792](../src/lib/rules.ts#L792) | [app/api/sessions/[id]/[action]/route.ts:56](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L56) |
|  `` finalRefusal ``  ·  `` gone ``  |  `` line ``  |  `` You rated this test, so your part is finished. ``  · [lib/rules.ts:228](../src/lib/rules.ts#L228)<br> `` You left this test. ``  · [lib/rules.ts:228](../src/lib/rules.ts#L228)<br> ``  ``  · [lib/rules.ts:232](../src/lib/rules.ts#L232)<br> `` `Your session on ${c.title ?? "this test"} ended.` ``  · [lib/rules.ts:748](../src/lib/rules.ts#L748)<br> `` `${teamStopHalf(c, fmt)}. Work you sent is still reviewed.` ``  · [lib/rules.ts:749](../src/lib/rules.ts#L749)<br> `` `${devName} stopped the test on ${fmt(c.endedAt)}. Work you sent is still reviewed.` ``  · [lib/rules.ts:750](../src/lib/rules.ts#L750)<br> `` `This test ended on ${fmt(c.endedAt)}. Work you sent is still reviewed.` ``  · [lib/rules.ts:751](../src/lib/rules.ts#L751)<br> `` `${devName} finished your part in ${c.title ?? "this test"}. Work you sent is still reviewed.` ``  · [lib/rules.ts:752](../src/lib/rules.ts#L752)<br> `` `${devName} ended your session early on ${fmt(c.endedAt)}. Work you sent is still reviewed.` ``  · [lib/rules.ts:753](../src/lib/rules.ts#L753) | [app/api/sessions/[id]/[action]/route.ts:59](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L59) |
|  `` pausedRefusal ``  ·  `` paused ``  |  `` SEND_ACTIONS.has(action) &#124;&#124; !PAUSE_DEFAULTS.draftsEditable ``  |  `` `${PAUSED_RIGHT_NOW} You can send this once it resumes.` ``  · [lib/rules.ts:923](../src/lib/rules.ts#L923) | [app/api/sessions/[id]/[action]/route.ts:74](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L74) |
|  `` limitedUser ``  ·  `` inactive ``  |  `` action === "choose" &#124;&#124; action === "rate" → me.testerSuspendedAt ``  |  `` You can rate once your account is active again. ``  · [lib/rules.ts:1825](../src/lib/rules.ts#L1825)<br> `` You can do this once your account is active again. ``  · [lib/rules.ts:762](../src/lib/rules.ts#L762) | [app/api/sessions/[id]/[action]/route.ts:123](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L123) |
|  `` run ``  ·  `` not_found ``  |  `` case "nda-seen" → !c &#124;&#124; c.testerId !== u.id ``  |  `` That session doesn't exist or isn't yours. ``  | [app/api/sessions/[id]/[action]/route.ts:164](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L164) |
|  `` run ``  ·  `` not_found ``  |  `` case "terms-pill" → !c &#124;&#124; c.testerId !== u.id ``  |  `` That session doesn't exist or isn't yours. ``  | [app/api/sessions/[id]/[action]/route.ts:173](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L173) |
|  `` run ``  ·  `` not_found ``  |  `` case "dismiss-removed" → !c &#124;&#124; c.testerId !== u.id &#124;&#124; c.endKind !== "suspended" ``  |  `` That card isn't there any more. ``  | [app/api/sessions/[id]/[action]/route.ts:182](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L182) |
|  `` run ``  ·  `` not_found ``  | See handler |  `` That action doesn't exist. ``  | [app/api/sessions/[id]/[action]/route.ts:234](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L234) |

### `src/app/api/tests/[id]/[action]/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` GET ``  ·  `` signed_out ``  |  `` !u ``  |  `` You're signed out. Sign in again to keep going. ``  | [app/api/tests/[id]/[action]/route.ts:35](../src/app/api/tests/%5Bid%5D/%5Baction%5D/route.ts#L35) |
|  `` GET ``  ·  `` not_found ``  |  `` action !== "listing" ``  |  `` That doesn't exist. ``  | [app/api/tests/[id]/[action]/route.ts:36](../src/app/api/tests/%5Bid%5D/%5Baction%5D/route.ts#L36) |
|  `` adminRefusal ``  ·  `` admin_stopped ``  |  `` t.adminStoppedAt && !STOPPED_ALLOWS.has(action) && action !== "edit" ``  |  `` The team stopped this test. ``  | [app/api/tests/[id]/[action]/route.ts:78](../src/app/api/tests/%5Bid%5D/%5Baction%5D/route.ts#L78) |
|  `` adminRefusal ``  ·  `` admin_paused ``  |  `` teamPausedNow(t) && !TEAM_PAUSED_OK_ACTIONS.has(action) && action !== "rate" && action !== "edit" ``  |  `` The team paused this test: you can stop it, end testers' work early, cancel calls, or add your side of a dispute. ``  · [lib/restricted.ts:65](../src/lib/restricted.ts#L65) | [app/api/tests/[id]/[action]/route.ts:83](../src/app/api/tests/%5Bid%5D/%5Baction%5D/route.ts#L83) |
|  `` run ``  ·  `` not_found ``  | See handler |  `` That action doesn't exist. ``  | [app/api/tests/[id]/[action]/route.ts:176](../src/app/api/tests/%5Bid%5D/%5Baction%5D/route.ts#L176) |

### `src/lib/server/accessKeys.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` assignKeyAtJoin ``  ·  `` no_key ``  |  `` !free ``  |  `` No access key is free right now, so this test can't take another tester until the developer adds one. ``  | [lib/server/accessKeys.ts:84](../src/lib/server/accessKeys.ts#L84) |
|  `` checkTypedKeys ``  ·  `` bad_keys ``  |  `` dup.length ``  |  `` `${dup.join(", ")} ${dup.length === 1 ? "is" : "are"} typed more than once. Each key goes in once.` ``  | [lib/server/accessKeys.ts:125](../src/lib/server/accessKeys.ts#L125) |
|  `` checkTypedKeys ``  ·  `` bad_keys ``  |  `` long ``  |  `` `A key can be at most ${KEY_MAX_LENGTH} characters.` ``  · [lib/keys.ts:5](../src/lib/keys.ts#L5) | [lib/server/accessKeys.ts:127](../src/lib/server/accessKeys.ts#L127) |

### `src/lib/server/accountState.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` withAccountState ``  ·  `` e.code ``  |  `` e instanceof HttpError && e.status === 409 ``  |  `` e.message ``  | [lib/server/accountState.ts:75](../src/lib/server/accountState.ts#L75) |

### `src/lib/server/adminRace.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` stoppedRefusal ``  ·  `` stopped ``  |  `` t.adminStoppedById ``  |  `` await alreadyLine(p, t.adminStoppedById, at, (who) => `That test was already ${word} ${byAt(who, at)}.`, `${word} this test`) ``  | [lib/server/adminRace.ts:194](../src/lib/server/adminRace.ts#L194) |
|  `` stoppedRefusal ``  ·  `` stopped ``  | See handler |  `` `That test was already ${word} ${byAt(who, at)}.` ``  | [lib/server/adminRace.ts:198](../src/lib/server/adminRace.ts#L198) |
|  `` pausedRefusal ``  ·  `` already ``  | See handler |  `` await alreadyLine(p, t.adminPausedById, at, (who) => `That test was already paused ${byAt(who, at)}.`, "paused this test") ``  | [lib/server/adminRace.ts:204](../src/lib/server/adminRace.ts#L204) |
|  `` liftRefusal ``  ·  `` pause_lifted ``  |  `` last ``  |  `` await alreadyLine(p, last.adminId, last.createdAt, (who) => `That test's pause was already lifted ${byAt(who, last.createdAt)}.`, "lifted the pause on this test", "an admin (deleted)") ``  | [lib/server/adminRace.ts:217](../src/lib/server/adminRace.ts#L217) |
|  `` liftRefusal ``  ·  `` pause_lifted ``  |  `` t.developer.holdStartedAt &#124;&#124; t.developer.devSuspendedAt ``  |  `` That test isn't paused by the team: it's paused by the developer's account state. ``  | [lib/server/adminRace.ts:218](../src/lib/server/adminRace.ts#L218) |
|  `` liftRefusal ``  ·  `` pause_lifted ``  | See handler |  `` That test isn't paused. ``  | [lib/server/adminRace.ts:219](../src/lib/server/adminRace.ts#L219) |

### `src/lib/server/bankHeartbeat.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` endReservationCheck ``  ·  `` not_found ``  |  `` !r &#124;&#124; r.developerId !== devId ``  |  `` There's no bank check waiting here. ``  · [lib/rules.ts:965](../src/lib/rules.ts#L965) | [lib/server/bankHeartbeat.ts:33](../src/lib/server/bankHeartbeat.ts#L33) |
|  `` endReservationCheck ``  ·  `` no_check ``  |  `` r.status !== "needs_action" ``  |  `` There's no bank check waiting here. ``  · [lib/rules.ts:965](../src/lib/rules.ts#L965) | [lib/server/bankHeartbeat.ts:36](../src/lib/server/bankHeartbeat.ts#L36) |

### `src/lib/server/bankPeek.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` peekBankCheck ``  ·  `` bad_setup ``  |  `` setupIntent → si.metadata?.userId !== dev.id &#124;&#124; si.metadata?.purpose !== "chargeback-verify" ``  |  `` That card check belongs to another account. ``  | [lib/server/bankPeek.ts:254](../src/lib/server/bankPeek.ts#L254) |
|  `` peekBankCheck ``  ·  `` not_found ``  |  `` !paymentId ``  |  `` There's nothing to confirm here. ``  · [lib/server/bankPeek.ts:34](../src/lib/server/bankPeek.ts#L34) | [lib/server/bankPeek.ts:260](../src/lib/server/bankPeek.ts#L260) |
|  `` peekBankCheck ``  ·  `` not_found ``  |  `` !p &#124;&#124; p.developerId !== dev.id ``  |  `` There's nothing to confirm here. ``  · [lib/server/bankPeek.ts:34](../src/lib/server/bankPeek.ts#L34) | [lib/server/bankPeek.ts:285](../src/lib/server/bankPeek.ts#L285) |

### `src/lib/server/blocks.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` blockUser ``  ·  `` bad_user ``  |  `` !otherId &#124;&#124; otherId === me.id ``  |  `` Choose someone to block. ``  | [lib/server/blocks.ts:51](../src/lib/server/blocks.ts#L51) |
|  `` blockUser ``  ·  `` not_found ``  |  `` !other ``  |  `` That person doesn't exist. ``  | [lib/server/blocks.ts:53](../src/lib/server/blocks.ts#L53) |
|  `` blockUser ``  ·  `` already ``  |  `` await iBlocked(me.id, otherId) ``  |  `` `You already blocked ${displayName(other)}.` ``  | [lib/server/blocks.ts:55](../src/lib/server/blocks.ts#L55) |
|  `` blockUser ``  ·  `` already ``  |  `` isUniqueClash(e) ``  |  `` `You already blocked ${displayName(other)}.` ``  | [lib/server/blocks.ts:62](../src/lib/server/blocks.ts#L62) |
|  `` joinCall ``  ·  `` cant_join ``  |  `` own && (own.contract.testerId === user.id &#124;&#124; own.contract.test.developerId === user.id) && ((await callEndState(callId))?.ended &#124;&#124; own.endedAt) ``  |  `` This call is over. ``  · [lib/callMeasure.ts:212](../src/lib/callMeasure.ts#L212) | [lib/server/blocks.ts:127](../src/lib/server/blocks.ts#L127) |
|  `` joinCall ``  ·  `` not_found ``  |  `` !call &#124;&#124; !c &#124;&#124; !side ``  |  `` That call doesn't exist. ``  | [lib/server/blocks.ts:131](../src/lib/server/blocks.ts#L131) |
|  `` joinCall ``  ·  `` cant_join ``  |  `` refusal ``  |  `` `Your Join call didn't go through: ${why}.` ``  | [lib/server/blocks.ts:147](../src/lib/server/blocks.ts#L147) |
|  `` callStatus ``  ·  `` not_found ``  |  `` !call &#124;&#124; !c &#124;&#124; (c.testerId !== user.id && c.test.developerId !== user.id) ``  |  `` That call doesn't exist. ``  | [lib/server/blocks.ts:166](../src/lib/server/blocks.ts#L166) |

### `src/lib/server/calls.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` devCancelCall ``  ·  `` not_found ``  |  `` !c &#124;&#124; c.contract.testId !== testId ``  |  `` That call doesn't exist. ``  | [lib/server/calls.ts:32](../src/lib/server/calls.ts#L32) |
|  `` devCancelCall ``  ·  `` cancelled ``  |  `` c.status === "cancelled" ``  |  `` `The call with ${name} was already cancelled.` ``  | [lib/server/calls.ts:36](../src/lib/server/calls.ts#L36) |
|  `` devCancelCall ``  ·  `` reason ``  |  `` !ok.ok ``  |  `` ok.message ``  · [lib/rules.ts:73](../src/lib/rules.ts#L73) | [lib/server/calls.ts:38](../src/lib/server/calls.ts#L38) |
|  `` testerCancelCall ``  ·  `` not_found ``  |  `` !call &#124;&#124; call.contractId !== contractId ``  |  `` That call doesn't exist. ``  | [lib/server/calls.ts:84](../src/lib/server/calls.ts#L84) |
|  `` testerCancelCall ``  ·  `` cancelled ``  |  `` call.status === "cancelled" ``  |  `` `Your call with ${displayName(c0.test.developer)} on ${fmtDateTime(call.startsAt)} was already cancelled.` ``  | [lib/server/calls.ts:85](../src/lib/server/calls.ts#L85) |
|  `` testerCancelCall ``  ·  `` reason ``  |  `` !ok.ok ``  |  `` ok.message ``  · [lib/rules.ts:73](../src/lib/rules.ts#L73) | [lib/server/calls.ts:87](../src/lib/server/calls.ts#L87) |
|  `` reportNoShow ``  ·  `` not_found ``  |  `` !call &#124;&#124; !side ``  |  `` That call doesn't exist. ``  | [lib/server/calls.ts:103](../src/lib/server/calls.ts#L103) |
|  `` reportNoShow ``  ·  `` cancelled ``  |  `` call.status !== "booked" ``  |  `` This call was cancelled. ``  | [lib/server/calls.ts:104](../src/lib/server/calls.ts#L104) |
|  `` reportNoShow ``  ·  `` not_yet ``  |  `` call.startsAt > new Date() ``  |  `` You can report a problem once the call's time has started. ``  | [lib/server/calls.ts:105](../src/lib/server/calls.ts#L105) |
|  `` reportNoShow ``  ·  `` reported ``  |  `` call.noShowBy ``  |  `` A problem with this call was already reported. ``  | [lib/server/calls.ts:106](../src/lib/server/calls.ts#L106) |
|  `` reportNoShow ``  ·  `` bad_note ``  |  `` !kind && typed.length < 10 ``  |  `` Say what happened. ``  | [lib/server/calls.ts:110](../src/lib/server/calls.ts#L110) |
|  `` reportNoShow ``  ·  `` reported ``  |  `` claimed.count !== 1 ``  |  `` A problem with this call was already reported. ``  | [lib/server/calls.ts:116](../src/lib/server/calls.ts#L116) |
|  `` refusal ``  ·  `` not_available ``  |  `` !call ``  |  `` This call isn't available. ``  · [lib/callMeasure.ts:184](../src/lib/callMeasure.ts#L184) | [lib/server/calls.ts:273](../src/lib/server/calls.ts#L273) |
|  `` refusal ``  ·  `` not_available ``  | See handler |  `` This call isn't available. ``  · [lib/callMeasure.ts:184](../src/lib/callMeasure.ts#L184) | [lib/server/calls.ts:276](../src/lib/server/calls.ts#L276) |
|  `` heartbeat ``  ·  `` not_available ``  |  `` !call &#124;&#124; !side ``  |  `` This call isn't available. ``  · [lib/callMeasure.ts:184](../src/lib/callMeasure.ts#L184) | [lib/server/calls.ts:300](../src/lib/server/calls.ts#L300) |
|  `` roomPoll ``  ·  `` not_available ``  |  `` !call &#124;&#124; !side ``  |  `` This call isn't available. ``  · [lib/callMeasure.ts:184](../src/lib/callMeasure.ts#L184) | [lib/server/calls.ts:316](../src/lib/server/calls.ts#L316) |
|  `` roomSend ``  ·  `` not_available ``  |  `` !call &#124;&#124; !side ``  |  `` This call isn't available. ``  · [lib/callMeasure.ts:184](../src/lib/callMeasure.ts#L184) | [lib/server/calls.ts:349](../src/lib/server/calls.ts#L349) |
|  `` roomSend ``  ·  `` bad_request ``  |  `` !ROOM_KINDS.includes(k) ``  |  `` Something went wrong sending that. Reload the page and try again. ``  | [lib/server/calls.ts:351](../src/lib/server/calls.ts#L351) |
|  `` roomSend ``  ·  `` too_large ``  |  `` body.length > MAX_SIGNAL ``  |  `` That's too much to send at once. Try sending less at once. ``  | [lib/server/calls.ts:368](../src/lib/server/calls.ts#L368) |
|  `` roomLeave ``  ·  `` not_available ``  |  `` !call &#124;&#124; !side ``  |  `` This call isn't available. ``  · [lib/callMeasure.ts:184](../src/lib/callMeasure.ts#L184) | [lib/server/calls.ts:377](../src/lib/server/calls.ts#L377) |

### `src/lib/server/cardLimits.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` cardAttempt ``  ·  `` too_many_cards ``  |  `` byAccount >= CARD_ATTEMPTS_PER_ACCOUNT &#124;&#124; (ip && byNetwork >= CARD_ATTEMPTS_PER_NETWORK) ``  |  `` Too many card attempts today. Try again tomorrow, or contact us. ``  · [lib/server/cardLimits.ts:13](../src/lib/server/cardLimits.ts#L13) | [lib/server/cardLimits.ts:26](../src/lib/server/cardLimits.ts#L26) |

### `src/lib/server/chargeback.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` reserveOwed ``  ·  `` nothing_owed ``  |  `` !r ``  |  `` There's nothing more to reserve: what you owe is already reserved on your card. ``  · [lib/server/holds.ts:705](../src/lib/server/holds.ts#L705) | [lib/server/chargeback.ts:131](../src/lib/server/chargeback.ts#L131) |
|  `` reserveOwed ``  ·  `` owed_in_flight ``  |  `` "elsewhere" in r ``  |  `` `Pay what you owe (${amount}) is waiting for your bank in another tab or window: finish that check, or cancel it.` ``  · [lib/bankNotice.ts:81](../src/lib/bankNotice.ts#L81) | [lib/server/chargeback.ts:132](../src/lib/server/chargeback.ts#L132) |
|  `` reservationChecked ``  ·  `` not_found ``  |  `` !r &#124;&#124; r.developerId !== devId ``  |  `` There's nothing to confirm here. ``  | [lib/server/chargeback.ts:172](../src/lib/server/chargeback.ts#L172) |
|  `` reservationChecked ``  ·  `` not_confirmed ``  |  `` r.status !== "needs_action" ``  |  `` Your bank didn't confirm the payment, so nothing was charged. ``  · [lib/rules.ts:957](../src/lib/rules.ts#L957) | [lib/server/chargeback.ts:174](../src/lib/server/chargeback.ts#L174) |
|  `` reservationChecked ``  ·  `` not_confirmed ``  |  `` !ok ``  |  `` Your bank didn't confirm the payment, so nothing was charged. ``  · [lib/rules.ts:957](../src/lib/rules.ts#L957) | [lib/server/chargeback.ts:177](../src/lib/server/chargeback.ts#L177) |
|  `` markVerified ``  ·  `` already_verified ``  |  `` (await db.user.updateMany({ where: { id: userId, chargebackCardVerifiedAt: null }, data: { chargebackCardVerifiedAt: now, ...data } })).count !== 1 ``  |  `` Your card is already verified. ``  · [lib/server/chargeback.ts:213](../src/lib/server/chargeback.ts#L213) | [lib/server/chargeback.ts:216](../src/lib/server/chargeback.ts#L216) |
|  `` refuseVerified ``  ·  `` already_verified ``  |  `` u?.holdStartedAt && u.holdReason === "chargeback" && u.chargebackCardVerifiedAt ``  |  `` Your card is already verified. ``  · [lib/server/chargeback.ts:213](../src/lib/server/chargeback.ts#L213) | [lib/server/chargeback.ts:221](../src/lib/server/chargeback.ts#L221) |
|  `` startCardVerification ``  ·  `` no_chargeback_hold ``  |  `` !steps ``  |  `` Your account isn't on a chargeback hold, so there's nothing to verify. ``  | [lib/server/chargeback.ts:230](../src/lib/server/chargeback.ts#L230) |
|  `` startCardVerification ``  ·  `` already_verified ``  |  `` steps.cardVerified ``  |  `` Your card is already verified. ``  · [lib/server/chargeback.ts:213](../src/lib/server/chargeback.ts#L213) | [lib/server/chargeback.ts:231](../src/lib/server/chargeback.ts#L231) |
|  `` confirmCardCheck ``  ·  `` simulated ``  |  `` simulated() ``  |  `` There's no card form to confirm here. ``  | [lib/server/chargeback.ts:262](../src/lib/server/chargeback.ts#L262) |
|  `` confirmCardCheck ``  ·  `` not_verified ``  |  `` isMissing(e) ``  |  `` The card wasn't verified. Try again or use another card. ``  · [lib/rules.ts:995](../src/lib/rules.ts#L995) | [lib/server/chargeback.ts:265](../src/lib/server/chargeback.ts#L265) |
|  `` confirmCardCheck ``  ·  `` bad_setup ``  |  `` si.metadata?.userId !== userId &#124;&#124; si.metadata?.purpose !== "chargeback-verify" ``  |  `` That card check belongs to another account. ``  | [lib/server/chargeback.ts:266](../src/lib/server/chargeback.ts#L266) |
|  `` confirmCardCheck ``  ·  `` not_verified ``  | See handler |  `` The card wasn't verified. Try again or use another card. ``  · [lib/rules.ts:995](../src/lib/rules.ts#L995) | [lib/server/chargeback.ts:272](../src/lib/server/chargeback.ts#L272) |
|  `` finishCardCheck ``  ·  `` not_verified ``  |  `` simulated() && simulate !== "succeeded" ``  |  `` The card wasn't verified. Try again or use another card. ``  · [lib/rules.ts:995](../src/lib/rules.ts#L995) | [lib/server/chargeback.ts:278](../src/lib/server/chargeback.ts#L278) |
|  `` finishCardVerification ``  ·  `` no_chargeback_hold ``  |  `` !user.holdStartedAt &#124;&#124; user.holdReason !== "chargeback" ``  |  `` Your account isn't on a chargeback hold. ``  | [lib/server/chargeback.ts:288](../src/lib/server/chargeback.ts#L288) |
|  `` finishCardVerification ``  ·  `` already_verified ``  |  `` user.chargebackCardVerifiedAt ``  |  `` Your card is already verified. ``  · [lib/server/chargeback.ts:213](../src/lib/server/chargeback.ts#L213) | [lib/server/chargeback.ts:289](../src/lib/server/chargeback.ts#L289) |
|  `` finishCardVerification ``  ·  `` not_verified ``  |  `` isMissing(e) ``  |  `` The card wasn't verified. Try again or use another card. ``  · [lib/rules.ts:995](../src/lib/rules.ts#L995) | [lib/server/chargeback.ts:295](../src/lib/server/chargeback.ts#L295) |
|  `` finishCardVerification ``  ·  `` bad_setup ``  |  `` si.metadata?.userId !== userId &#124;&#124; si.metadata?.purpose !== "chargeback-verify" &#124;&#124; (user.stripeCustomerId && si.customer !== user.stripeCustomerId) ``  |  `` That card check belongs to another account. ``  | [lib/server/chargeback.ts:297](../src/lib/server/chargeback.ts#L297) |
|  `` finishCardVerification ``  ·  `` old_setup ``  |  `` si.created * 1000 < user.holdStartedAt.getTime() - 60_000 ``  |  `` That card check is from before the hold. Verify a card again. ``  | [lib/server/chargeback.ts:298](../src/lib/server/chargeback.ts#L298) |
|  `` finishCardVerification ``  ·  `` not_verified ``  |  `` si.status !== "succeeded" ``  |  `` The card wasn't verified. Try again or use another card. ``  · [lib/rules.ts:995](../src/lib/rules.ts#L995) | [lib/server/chargeback.ts:299](../src/lib/server/chargeback.ts#L299) |
|  `` finishCardVerification ``  ·  `` not_verified ``  |  `` tds && tds.result !== "authenticated" && tds.result !== "attempt_acknowledged" ``  |  `` The bank didn't confirm it was you. Try again or use another card. ``  | [lib/server/chargeback.ts:302](../src/lib/server/chargeback.ts#L302) |
|  `` finishCardVerification ``  ·  `` no_card ``  |  `` !pm ``  |  `` The card wasn't saved. Try again. ``  | [lib/server/chargeback.ts:304](../src/lib/server/chargeback.ts#L304) |
|  `` approvedRefusal ``  ·  `` already ``  | See handler |  `` await race.alreadyLine(p, last.adminId, last.createdAt, (who) => `That hold was already approved ${race.byAt(who, last.createdAt)}.`, "approved lifting this hold") ``  | [lib/server/chargeback.ts:429](../src/lib/server/chargeback.ts#L429) |
|  `` approveChargebackHold ``  ·  `` no_chargeback_hold ``  |  `` !steps ``  |  `` That account isn't on a chargeback hold. ``  | [lib/server/chargeback.ts:452](../src/lib/server/chargeback.ts#L452) |
|  `` approveChargebackHold ``  ·  `` already ``  |  `` steps.approved ``  |  `` That hold was already approved. ``  | [lib/server/chargeback.ts:453](../src/lib/server/chargeback.ts#L453) |
|  `` approveChargebackHold ``  ·  `` steps_missing ``  |  `` !steps.cardVerified && nothingReserved ``  |  `` `Not yet: the card isn't verified, and nothing is reserved (${money(owedCents)} is owed${released ? `; ${released}` : ""}).` ``  | [lib/server/chargeback.ts:465](../src/lib/server/chargeback.ts#L465) |
|  `` approveChargebackHold ``  ·  `` steps_missing ``  |  `` !steps.cardVerified ``  |  `` Not yet: the card isn't verified. ``  | [lib/server/chargeback.ts:466](../src/lib/server/chargeback.ts#L466) |
|  `` approveChargebackHold ``  ·  `` steps_missing ``  |  `` nothingReserved ``  |  `` `Not yet: nothing is reserved (${money(owedCents)} is owed${released ? `; ${released}` : ""}).` ``  | [lib/server/chargeback.ts:467](../src/lib/server/chargeback.ts#L467) |
|  `` approveChargebackHold ``  ·  `` already ``  |  `` claimed.count !== 1 ``  |  `` That hold was already approved. ``  | [lib/server/chargeback.ts:479](../src/lib/server/chargeback.ts#L479) |
|  `` approveChargebackHold ``  ·  `` reserve_expired ``  |  `` r.stripePaymentIntentId && stripeOn() ``  |  `` The reservation can't be taken any more (it expired): the developer needs to press Pay what you owe again. ``  | [lib/server/chargeback.ts:500](../src/lib/server/chargeback.ts#L500) |
|  `` allowPaying ``  ·  `` already ``  |  `` claimed !== 1 ``  |  `` That hold was already approved. ``  | [lib/server/chargeback.ts:547](../src/lib/server/chargeback.ts#L547) |
|  `` declineChargebackReserve ``  ·  `` no_chargeback_hold ``  |  `` !u?.holdStartedAt &#124;&#124; u.holdReason !== "chargeback" ``  |  `` That account isn't on a chargeback hold. ``  | [lib/server/chargeback.ts:567](../src/lib/server/chargeback.ts#L567) |
|  `` declineChargebackReserve ``  ·  `` already ``  |  `` u.chargebackApprovedAt ``  |  `` That hold was already approved. ``  | [lib/server/chargeback.ts:568](../src/lib/server/chargeback.ts#L568) |
|  `` declineChargebackReserve ``  ·  `` nothing_reserved ``  |  `` !cents ``  |  `` `Nothing is reserved on that account (${released}).` ``  · [lib/server/chargeback.ts:574](../src/lib/server/chargeback.ts#L574)<br> `` Nothing is reserved on that account. ``  · [lib/server/chargeback.ts:574](../src/lib/server/chargeback.ts#L574) | [lib/server/chargeback.ts:574](../src/lib/server/chargeback.ts#L574) |

### `src/lib/server/confirm.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` startable ``  ·  `` not_found ``  |  `` !p &#124;&#124; p.developerId !== devId ``  |  `` There's nothing to confirm here. ``  | [lib/server/confirm.ts:312](../src/lib/server/confirm.ts#L312) |
|  `` startable ``  ·  `` confirmed ``  |  `` !p.actionPi → p.status === "charged" &#124;&#124; p.status === "not_set_up" ``  |  `` `You already confirmed this payment in another tab at ${fmtTimeIn(mine.at, (await db.user.findUnique({ where: { id: devId }, select: { timeZone: true } }))?.timeZone ?? null)}.` ``  · [lib/server/confirm.ts:306](../src/lib/server/confirm.ts#L306) | [lib/server/confirm.ts:316](../src/lib/server/confirm.ts#L316) |
|  `` startable ``  ·  `` cancelled ``  |  `` !p.actionPi → p.status === "cancelled" ``  |  `` This payment was cancelled: nothing was charged. ``  · [lib/pressLabels.ts:9](../src/lib/pressLabels.ts#L9) | [lib/server/confirm.ts:317](../src/lib/server/confirm.ts#L317) |
|  `` startable ``  ·  `` expired ``  |  `` !p.actionPi ``  |  `` This confirmation expired: nothing was charged. ``  · [lib/server/confirm.ts:298](../src/lib/server/confirm.ts#L298) | [lib/server/confirm.ts:318](../src/lib/server/confirm.ts#L318) |
|  `` startable ``  ·  `` expired ``  |  `` p.actionBy && p.actionBy <= new Date() ``  |  `` This confirmation expired: nothing was charged. ``  · [lib/server/confirm.ts:298](../src/lib/server/confirm.ts#L298) | [lib/server/confirm.ts:322](../src/lib/server/confirm.ts#L322) |
|  `` own ``  ·  `` cancelled ``  |  `` p && p.developerId === devId && !p.actionPi && p.status === "cancelled" ``  |  `` This payment was cancelled: nothing was charged. ``  · [lib/pressLabels.ts:9](../src/lib/pressLabels.ts#L9) | [lib/server/confirm.ts:383](../src/lib/server/confirm.ts#L383) |
|  `` own ``  ·  `` confirmed ``  |  `` p && p.developerId === devId && !p.actionPi && PAID_STATES.includes(p.status) → by && by.tab && by.tab !== tab ``  |  `` `You already confirmed this payment in another tab at ${fmtTimeIn(at, (await db.user.findUnique({ where: { id: devId }, select: { timeZone: true } }))?.timeZone ?? null)}.` ``  · [lib/server/confirm.ts:348](../src/lib/server/confirm.ts#L348) | [lib/server/confirm.ts:391](../src/lib/server/confirm.ts#L391) |
|  `` own ``  ·  `` confirmed ``  |  `` p && p.developerId === devId && !p.actionPi && PAID_STATES.includes(p.status) ``  |  `` line ``  · [lib/server/confirm.ts:392](../src/lib/server/confirm.ts#L392) | [lib/server/confirm.ts:399](../src/lib/server/confirm.ts#L399) |
|  `` own ``  ·  `` not_found ``  |  `` !p &#124;&#124; p.developerId !== devId &#124;&#124; !p.actionPi ``  |  `` There's nothing to confirm here. ``  | [lib/server/confirm.ts:401](../src/lib/server/confirm.ts#L401) |
|  `` refuseInAll ``  ·  `` in_all ``  |  `` one && once.isAll(one) && once.OWED_ACTIVE.includes(one.status) ``  |  `` This payment is in your Confirm all, waiting for your bank: finish that check, or cancel it. ``  · [lib/confirmAllText.ts:29](../src/lib/confirmAllText.ts#L29) | [lib/server/confirm.ts:413](../src/lib/server/confirm.ts#L413) |
|  `` refusePaused ``  ·  `` paused ``  |  `` paused ``  |  `` This payment is paused until your tests resume. ``  · [lib/server/confirm.ts:417](../src/lib/server/confirm.ts#L417) | [lib/server/confirm.ts:420](../src/lib/server/confirm.ts#L420) |
|  `` confirmStart ``  ·  `` needs_tick ``  |  `` overTickNeeded(p) && body.over200 !== true ``  |  `` `Tick “${OVER_PAY_TICK_LINE}” to pay.` ``  · [lib/server/confirm.ts:294](../src/lib/server/confirm.ts#L294) | [lib/server/confirm.ts:456](../src/lib/server/confirm.ts#L456) |
|  `` confirmStart ``  ·  `` cancelled ``  | See handler |  `` This payment was cancelled: nothing was charged. ``  · [lib/pressLabels.ts:9](../src/lib/pressLabels.ts#L9) | [lib/server/confirm.ts:472](../src/lib/server/confirm.ts#L472) |
|  `` confirmStart ``  ·  `` no_card ``  |  `` (pi.status === "requires_payment_method" &#124;&#124; pi.status === "requires_confirmation" &#124;&#124; sdkOnly &#124;&#124; otherCard) && u.stripePaymentMethodId && typeof stripe.paymentIntents.confirm === "function" → isMissing(e) ``  |  `` Add a card in Payments first, then press Pay again. ``  · [lib/server/stripe.ts:145](../src/lib/server/stripe.ts#L145) | [lib/server/confirm.ts:488](../src/lib/server/confirm.ts#L488) |
|  `` confirmStart ``  ·  `` not_confirmed ``  |  `` (pi.status === "requires_payment_method" &#124;&#124; pi.status === "requires_confirmation" &#124;&#124; sdkOnly &#124;&#124; otherCard) && u.stripePaymentMethodId && typeof stripe.paymentIntents.confirm === "function" ``  |  `` `Your card was declined, so nothing was charged. Change your card and confirm again by ${by}.` ``  · [lib/rules.ts:969](../src/lib/rules.ts#L969)<br> `` Your bank didn't confirm the payment, so nothing was charged. ``  · [lib/rules.ts:957](../src/lib/rules.ts#L957) | [lib/server/confirm.ts:492](../src/lib/server/confirm.ts#L492) |
|  `` confirmFinish ``  ·  `` not_confirmed ``  |  `` !ok → else p.status === "needs_action" &#124;&#124; p.status === "paying" → ["needs_confirmation", "failed", "owed"].includes(p.status) && p.actionBy && p.actionBy > new Date() ``  |  `` `${STILL_WAITS} Confirm with your bank by ${by}.` ``  · [lib/bankNotice.ts:54](../src/lib/bankNotice.ts#L54) | [lib/server/confirm.ts:542](../src/lib/server/confirm.ts#L542) |
|  `` confirmFinish ``  ·  `` not_confirmed ``  |  `` !ok ``  |  `` `Your bank didn't confirm the payment, so nothing was charged. ${ALL_BACK}` ``  · [lib/confirmAllText.ts:22](../src/lib/confirmAllText.ts#L22)<br> `` Your bank didn't confirm the payment, so nothing was charged. ``  · [lib/rules.ts:957](../src/lib/rules.ts#L957) | [lib/server/confirm.ts:546](../src/lib/server/confirm.ts#L546) |

### `src/lib/server/confirmAll.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` confirmAllPress ``  ·  `` busy ``  |  `` await openAll(dev.id) ``  |  `` Your Confirm all is already waiting for your bank: finish that check, or cancel it. ``  · [lib/confirmAllText.ts:27](../src/lib/confirmAllText.ts#L27) | [lib/server/confirmAll.ts:157](../src/lib/server/confirmAll.ts#L157) |
|  `` confirmAllPress ``  ·  `` nothing ``  |  `` !waiting.length ``  |  `` There's nothing waiting for your bank to confirm. ``  · [lib/confirmAllText.ts:30](../src/lib/confirmAllText.ts#L30)<br> `` `You already confirmed ${seenIds.length === 1 ? "this payment" : "these payments"} in another tab at ${fmtTimeIn(last, tz)}.` ``  · [lib/server/confirmAll.ts:238](../src/lib/server/confirmAll.ts#L238) | [lib/server/confirmAll.ts:161](../src/lib/server/confirmAll.ts#L161) |
|  `` confirmAllPress ``  ·  `` needs_tick ``  |  `` sum(waiting) > PAY_TICK_CENTS && body.over200 !== true ``  |  `` `Tick “${OVER_PAY_TICK_LINE}” to pay.` ``  | [lib/server/confirmAll.ts:164](../src/lib/server/confirmAll.ts#L164) |
|  `` confirmAllPress ``  ·  `` busy ``  |  `` !one → await openAll(dev.id) ``  |  `` Your Confirm all is already waiting for your bank: finish that check, or cancel it. ``  · [lib/confirmAllText.ts:27](../src/lib/confirmAllText.ts#L27) | [lib/server/confirmAll.ts:167](../src/lib/server/confirmAll.ts#L167) |
|  `` confirmAllPress ``  ·  `` nothing ``  |  `` !one → !fresh.length ``  |  `` There's nothing waiting for your bank to confirm. ``  · [lib/confirmAllText.ts:30](../src/lib/confirmAllText.ts#L30)<br> `` `You already confirmed ${seenIds.length === 1 ? "this payment" : "these payments"} in another tab at ${fmtTimeIn(last, tz)}.` ``  · [lib/server/confirmAll.ts:238](../src/lib/server/confirmAll.ts#L238) | [lib/server/confirmAll.ts:170](../src/lib/server/confirmAll.ts#L170) |
|  `` confirmAllPress ``  ·  `` payment_unknown ``  |  `` r.result === "failed" && (await db.payment.findUnique({ where: { id: one.id }, select: { status: true } }))?.status === "paying" ``  |  `` We didn't hear back from the payment service. Nothing more will be charged: we'll check it again shortly. ``  | [lib/server/confirmAll.ts:215](../src/lib/server/confirmAll.ts#L215) |
|  `` confirmAllPress ``  ·  `` not_confirmed ``  | See handler |  `` T.allDeclinedLine(r.result === "failed" ? r.why : "", back, kept.length, declined) ``  · [lib/confirmAllText.ts:34](../src/lib/confirmAllText.ts#L34) | [lib/server/confirmAll.ts:221](../src/lib/server/confirmAll.ts#L221) |
|  `` cancelAll ``  ·  `` not_found ``  |  `` !p &#124;&#124; p.developerId !== devId &#124;&#124; !isAll(p) ``  |  `` There's no bank check waiting here. ``  · [lib/rules.ts:965](../src/lib/rules.ts#L965) | [lib/server/confirmAll.ts:291](../src/lib/server/confirmAll.ts#L291) |

### `src/lib/server/directMessages.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` ownRestriction ``  ·  `` suspended ``  |  `` asDev ? u.devSuspendedAt : u.testerSuspendedAt ``  |  `` Your account is suspended: your tests are paused. Contact us in Settings to appeal. ``  · [lib/server/users.ts:19](../src/lib/server/users.ts#L19)<br> `` Your account is paused. Contact support if you think this is a mistake. ``  · [lib/server/users.ts:12](../src/lib/server/users.ts#L12) | [lib/server/directMessages.ts:29](../src/lib/server/directMessages.ts#L29) |
|  `` ownRestriction ``  ·  `` held ``  |  `` asDev && u.holdStartedAt ``  |  `` Your tests are paused after a chargeback. Open Payments to see the steps. ``  · [lib/server/users.ts:21](../src/lib/server/users.ts#L21)<br> `` Your tests are paused until you pay what you owe. Open Payments to pay. ``  · [lib/server/users.ts:20](../src/lib/server/users.ts#L20) | [lib/server/directMessages.ts:30](../src/lib/server/directMessages.ts#L30) |
|  `` sendDirect ``  ·  `` closed ``  |  `` a.other?.deletedAt ``  |  `` This chat is closed. ``  | [lib/server/directMessages.ts:51](../src/lib/server/directMessages.ts#L51) |
|  `` sendDirect ``  ·  `` unable ``  |  `` a.unable &#124;&#124; !a.me &#124;&#124; !a.other ``  |  `` Unable to chat with this developer. ``  · [lib/server/messages.ts:47](../src/lib/server/messages.ts#L47)<br> `` Unable to chat with this tester. ``  · [lib/server/messages.ts:28](../src/lib/server/messages.ts#L28) | [lib/server/directMessages.ts:52](../src/lib/server/directMessages.ts#L52) |
|  `` sendDirect ``  ·  `` chat_paused ``  |  `` a.paused ``  |  `` Messages are paused for now, so this wasn't sent. ``  · [lib/rules.ts:931](../src/lib/rules.ts#L931) | [lib/server/directMessages.ts:54](../src/lib/server/directMessages.ts#L54) |
|  `` sendDirect ``  ·  `` bad_request ``  |  `` clientId → again → again.conversationId !== a.conversation?.id ``  |  `` This page is out of date. ``  | [lib/server/directMessages.ts:58](../src/lib/server/directMessages.ts#L58) |
|  `` sendDirect ``  ·  `` empty ``  |  `` !body ``  |  `` Type a message first. ``  | [lib/server/directMessages.ts:62](../src/lib/server/directMessages.ts#L62) |
|  `` sendDirect ``  ·  `` too_long ``  |  `` body.length > CHAT_MAX ``  |  `` `Keep a message to ${CHAT_MAX.toLocaleString("en-US")} characters.` ``  | [lib/server/directMessages.ts:63](../src/lib/server/directMessages.ts#L63) |
|  `` sendDirect ``  ·  `` too_fast ``  |  `` counts[0] + counts[1] >= CHAT_PER_MINUTE ``  |  `` You're sending messages very fast. Wait a minute, then send again. ``  · [lib/server/messages.ts:73](../src/lib/server/messages.ts#L73) | [lib/server/directMessages.ts:66](../src/lib/server/directMessages.ts#L66) |
|  `` sendDirect ``  ·  `` new_conversations ``  |  `` !conversation → await tx.directConversation.count({ where: { startedById: userId, createdAt: { gt: new Date(Date.now() - 86_400_000) } } }) >= DIRECT_NEW_LIMIT ``  |  `` You've started 20 new conversations in the last 24 hours. Try again later. ``  · [lib/server/directMessages.ts:18](../src/lib/server/directMessages.ts#L18) | [lib/server/directMessages.ts:69](../src/lib/server/directMessages.ts#L69) |

### `src/lib/server/excerpts.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` requestExcerpt ``  ·  `` not_found ``  |  `` !sub &#124;&#124; sub.contract.testerId !== tester.id ``  |  `` That part doesn't exist or isn't yours. ``  | [lib/server/excerpts.ts:85](../src/lib/server/excerpts.ts#L85) |
|  `` requestExcerpt ``  ·  `` nda ``  |  `` t.ndaText ``  |  `` This test now has an NDA, so its work can't be shown as an excerpt. ``  · [lib/server/excerpts.ts:28](../src/lib/server/excerpts.ts#L28) | [lib/server/excerpts.ts:87](../src/lib/server/excerpts.ts#L87) |
|  `` requestExcerpt ``  ·  `` not_paid ``  |  `` !choices.length ``  |  `` Only written answers the developer paid for can be shown as excerpts. ``  | [lib/server/excerpts.ts:89](../src/lib/server/excerpts.ts#L89) |
|  `` requestExcerpt ``  ·  `` bad_pick ``  |  `` !pick ``  |  `` Pick one of your answers. ``  | [lib/server/excerpts.ts:91](../src/lib/server/excerpts.ts#L91) |
|  `` requestExcerpt ``  ·  `` bad_length ``  |  `` text.length < EXCERPT_MIN &#124;&#124; text.length > EXCERPT_MAX ``  |  `` `An excerpt is ${EXCERPT_MIN} to ${EXCERPT_MAX} characters.` ``  · [lib/server/excerpts.ts:42](../src/lib/server/excerpts.ts#L42) | [lib/server/excerpts.ts:93](../src/lib/server/excerpts.ts#L93) |
|  `` requestExcerpt ``  ·  `` not_from_answer ``  |  `` !fromAnswer(pick.text, text) ``  |  `` Trim the excerpt from your answer: it can only leave words out, not add any. ``  | [lib/server/excerpts.ts:96](../src/lib/server/excerpts.ts#L96) |
|  `` requestExcerpt ``  ·  `` same_pending ``  |  `` dup.some((e) => e.status === "pending") ``  |  `` You already asked to show this excerpt. ``  · [lib/server/excerpts.ts:38](../src/lib/server/excerpts.ts#L38) | [lib/server/excerpts.ts:108](../src/lib/server/excerpts.ts#L108) |
|  `` requestExcerpt ``  ·  `` same_shown ``  |  `` dup.length ``  |  `` This excerpt is already on your profile. ``  · [lib/server/excerpts.ts:39](../src/lib/server/excerpts.ts#L39) | [lib/server/excerpts.ts:109](../src/lib/server/excerpts.ts#L109) |
|  `` requestExcerpt ``  ·  `` pending ``  |  `` await tx.excerpt.count({ where: { submissionId: sub.id, status: "pending" } }) ``  |  `` You already asked to show an excerpt from this part. Wait for the developer's answer. ``  · [lib/server/excerpts.ts:36](../src/lib/server/excerpts.ts#L36) | [lib/server/excerpts.ts:110](../src/lib/server/excerpts.ts#L110) |
|  `` requestExcerpt ``  ·  `` pending_question ``  |  `` same.some((e) => e.status === "pending") ``  |  `` You already asked to show an excerpt for this question. Wait for the developer's answer. ``  · [lib/server/excerpts.ts:41](../src/lib/server/excerpts.ts#L41) | [lib/server/excerpts.ts:111](../src/lib/server/excerpts.ts#L111) |
|  `` requestExcerpt ``  ·  `` too_many ``  |  `` (await tx.excerpt.count({ where: { testerId: tester.id, status: { in: ["pending", "shown"] } } })) - replaced >= MAX_EXCERPTS ``  |  `` `You can show at most ${MAX_EXCERPTS} excerpts. Remove one first.` ``  · [lib/server/excerpts.ts:27](../src/lib/server/excerpts.ts#L27) | [lib/server/excerpts.ts:114](../src/lib/server/excerpts.ts#L114) |
|  `` decideExcerpt ``  ·  `` bad_decision ``  |  `` !allow && body.decision !== "deny" ``  |  `` Choose Allow or Deny. ``  | [lib/server/excerpts.ts:127](../src/lib/server/excerpts.ts#L127) |
|  `` decideExcerpt ``  ·  `` gone ``  |  `` !x ``  |  `` This request was already decided. ``  · [lib/server/excerpts.ts:34](../src/lib/server/excerpts.ts#L34) | [lib/server/excerpts.ts:131](../src/lib/server/excerpts.ts#L131) |
|  `` decideExcerpt ``  ·  `` gone ``  |  `` x.test.developerId !== dev.id ``  |  `` This request was already decided. ``  · [lib/server/excerpts.ts:34](../src/lib/server/excerpts.ts#L34) | [lib/server/excerpts.ts:132](../src/lib/server/excerpts.ts#L132) |
|  `` decideExcerpt ``  ·  `` decided ``  |  `` x.status !== "pending" ``  |  `` You already allowed this excerpt. ``  · [lib/server/excerpts.ts:183](../src/lib/server/excerpts.ts#L183)<br> `` You already denied this excerpt. ``  · [lib/server/excerpts.ts:183](../src/lib/server/excerpts.ts#L183) | [lib/server/excerpts.ts:134](../src/lib/server/excerpts.ts#L134) |
|  `` decideExcerpt ``  ·  `` decided ``  |  `` done.count !== 1 ``  |  `` You already allowed this excerpt. ``  · [lib/server/excerpts.ts:183](../src/lib/server/excerpts.ts#L183)<br> `` This request was already decided. ``  · [lib/server/excerpts.ts:34](../src/lib/server/excerpts.ts#L34) | [lib/server/excerpts.ts:145](../src/lib/server/excerpts.ts#L145) |
|  `` removeExcerpt ``  ·  `` tester_only ``  |  `` x && x.testerId !== user.id && x.test.developerId === user.id ``  |  `` Only the tester can remove an excerpt from their profile. ``  · [lib/server/excerpts.ts:46](../src/lib/server/excerpts.ts#L46) | [lib/server/excerpts.ts:160](../src/lib/server/excerpts.ts#L160) |
|  `` removeExcerpt ``  ·  `` gone ``  |  `` !x &#124;&#124; x.testerId !== user.id ``  |  `` This excerpt was already taken down. ``  · [lib/server/excerpts.ts:35](../src/lib/server/excerpts.ts#L35) | [lib/server/excerpts.ts:161](../src/lib/server/excerpts.ts#L161) |
|  `` removeExcerpt ``  ·  `` gone ``  |  `` gone !== 1 ``  |  `` This excerpt was already taken down. ``  · [lib/server/excerpts.ts:35](../src/lib/server/excerpts.ts#L35) | [lib/server/excerpts.ts:169](../src/lib/server/excerpts.ts#L169) |

### `src/lib/server/google.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` finishGoogleSignup ``  ·  `` expired ``  |  `` !step &#124;&#124; !token ``  |  `` This Google sign-up expired. Continue with Google again. ``  · [lib/server/google.ts:155](../src/lib/server/google.ts#L155) | [lib/server/google.ts:189](../src/lib/server/google.ts#L189) |
|  `` finishGoogleSignup ``  ·  `` closed ``  |  `` found ``  |  `` This account was closed. ``  · [lib/accountClosed.ts:5](../src/lib/accountClosed.ts#L5) | [lib/server/google.ts:199](../src/lib/server/google.ts#L199) |

### `src/lib/server/holds.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` devHoldRefusal ``  ·  `` on_hold ``  |  `` what === "pay" ``  |  `` Pay what you owe first. ``  · [lib/rules.ts:949](../src/lib/rules.ts#L949) | [lib/server/holds.ts:49](../src/lib/server/holds.ts#L49) |
|  `` devHoldRefusal ``  ·  `` on_hold ``  |  `` what === "post" ``  |  `` `${PAY_WAITS} New tests can't be posted while payments are on hold.` ``  | [lib/server/holds.ts:50](../src/lib/server/holds.ts#L50) |
|  `` devHoldRefusal ``  ·  `` on_hold ``  | See handler |  `` `${PAY_WAITS} Your tests are paused until then.` ``  | [lib/server/holds.ts:51](../src/lib/server/holds.ts#L51) |
|  `` testerHoldRefusal ``  ·  `` paused ``  |  `` await onHold(devId) ``  |  `` This test is paused right now. ``  · [lib/rules.ts:902](../src/lib/rules.ts#L902) | [lib/server/holds.ts:56](../src/lib/server/holds.ts#L56) |
|  `` approveHoldLift ``  ·  `` decided ``  |  `` !dev?.holdStartedAt &#124;&#124; dev.holdReason === "chargeback" &#124;&#124; dev.holdCount <= HOLD_APPROVAL_AFTER → ok && (!hold &#124;&#124; hold.createdAt <= ok.createdAt) → own ``  |  `` `You already ${what}${where === "other" ? " in another tab" : ""} at ${whenText(at)}.` ``  · [lib/server/adminRace.ts:95](../src/lib/server/adminRace.ts#L95) | [lib/server/holds.ts:500](../src/lib/server/holds.ts#L500) |
|  `` approveHoldLift ``  ·  `` decided ``  |  `` !dev?.holdStartedAt &#124;&#124; dev.holdReason === "chargeback" &#124;&#124; dev.holdCount <= HOLD_APPROVAL_AFTER → ok && (!hold &#124;&#124; hold.createdAt <= ok.createdAt) ``  |  `` `This lift was already approved${by ? ` by ${displayName(by)}` : ""} at ${fmtDateTime(ok.createdAt)}.` ``  | [lib/server/holds.ts:502](../src/lib/server/holds.ts#L502) |
|  `` approveHoldLift ``  ·  `` not_needed ``  |  `` !dev?.holdStartedAt &#124;&#124; dev.holdReason === "chargeback" &#124;&#124; dev.holdCount <= HOLD_APPROVAL_AFTER ``  |  `` That account's hold doesn't need an approval. ``  | [lib/server/holds.ts:504](../src/lib/server/holds.ts#L504) |
|  `` approveHoldLift → already ``  ·  `` decided ``  |  `` own && at ``  |  `` `You already ${what}${where === "other" ? " in another tab" : ""} at ${whenText(at)}.` ``  · [lib/server/adminRace.ts:95](../src/lib/server/adminRace.ts#L95) | [lib/server/holds.ts:513](../src/lib/server/holds.ts#L513) |
|  `` approveHoldLift → already ``  ·  `` decided ``  | See handler |  `` `This lift was already approved${by ? ` by ${displayName(by)}` : ""}${at ? ` at ${fmtDateTime(at)}` : ""}.` ``  | [lib/server/holds.ts:515](../src/lib/server/holds.ts#L515) |
|  `` payOwed ``  ·  `` review_first ``  |  `` reviewFirst && !u.chargebackApprovedAt ``  |  `` `Your account has had ${n} chargebacks: the team reviews it before you can pay. You'll get an email when you can.` ``  · [lib/rules.ts:1179](../src/lib/rules.ts#L1179) | [lib/server/holds.ts:564](../src/lib/server/holds.ts#L564) |
|  `` payOwed ``  ·  `` nothing_owed ``  |  `` rs && rs.reservedCents > 0 && list.length ``  |  `` `Reserved ${money(cents)}: it's taken when the team approves lifting your hold.` ``  · [lib/rules.ts:1166](../src/lib/rules.ts#L1166) | [lib/server/holds.ts:577](../src/lib/server/holds.ts#L577) |
|  `` payOwed ``  ·  `` bank_waiting ``  |  `` !list.length → all.length ``  |  `` What you owe is waiting for your bank: confirm it with your bank, or press Cancel this check to pay it now. ``  · [lib/rules.ts:962](../src/lib/rules.ts#L962) | [lib/server/holds.ts:582](../src/lib/server/holds.ts#L582) |
|  `` payOwed ``  ·  `` nothing_owed ``  |  `` !list.length → covered?.size ``  |  `` There's nothing more to reserve: what you owe is already reserved on your card. ``  · [lib/server/holds.ts:705](../src/lib/server/holds.ts#L705) | [lib/server/holds.ts:583](../src/lib/server/holds.ts#L583) |
|  `` payOwed ``  ·  `` nothing_owed ``  |  `` !list.length ``  |  `` There's nothing to pay: what you owed is already paid. ``  · [lib/server/holds.ts:703](../src/lib/server/holds.ts#L703) | [lib/server/holds.ts:584](../src/lib/server/holds.ts#L584) |
|  `` payOwed ``  ·  `` verify_first ``  |  `` u.holdStartedAt && u.holdReason === "chargeback" && !u.chargebackCardVerifiedAt ``  |  `` Verify your card first. ``  · [lib/server/holds.ts:1289](../src/lib/server/holds.ts#L1289) | [lib/server/holds.ts:645](../src/lib/server/holds.ts#L645) |
|  `` payOwed ``  ·  `` nothing_owed ``  |  `` r.result === "skipped" → paid && !withDebt(await payable(dev.id)).length ``  |  `` `You already paid what you owe (${money(one.amountCents)}) in another tab at ${fmtTime(one.settledAt ?? one.createdAt)}.` ``  · [lib/server/holds.ts:690](../src/lib/server/holds.ts#L690) | [lib/server/holds.ts:659](../src/lib/server/holds.ts#L659) |
|  `` chooseOutcome ``  ·  `` not_found ``  |  `` !s &#124;&#124; s.contractId !== contractId &#124;&#124; s.contract.testerId !== tester.id ``  |  `` That work doesn't exist. ``  | [lib/server/holds.ts:1883](../src/lib/server/holds.ts#L1883) |
|  `` chooseOutcome ``  ·  `` late ``  |  `` s.late ``  |  `` You can't charge for work sent after your deadline. ``  · [lib/moneyLines.ts:8](../src/lib/moneyLines.ts#L8) | [lib/server/holds.ts:1893](../src/lib/server/holds.ts#L1893) |
|  `` chooseOutcome ``  ·  `` not_yet ``  |  `` !s.choiceOfferedAt ``  |  `` `You can choose once ${REVIEW_DAYS} days have passed since you sent it and your deadline has passed.` ``  | [lib/server/holds.ts:1894](../src/lib/server/holds.ts#L1894) |
|  `` chooseOutcome ``  ·  `` bad_choice ``  |  `` !choice ``  |  `` Choose Charge or Let it go. ``  | [lib/server/holds.ts:1904](../src/lib/server/holds.ts#L1904) |
|  `` chooseOutcome ``  ·  `` paid_in_full ``  |  `` cap === 0 ``  |  `` This part is already paid in full. ``  | [lib/server/holds.ts:1908](../src/lib/server/holds.ts#L1908) |
|  `` chooseOutcome ``  ·  `` bad_amount ``  |  `` choice === "charge" && (typed == null &#124;&#124; typed <= 0) ``  |  `` Enter an amount like 5.00. ``  | [lib/server/holds.ts:1911](../src/lib/server/holds.ts#L1911) |
|  `` chooseOutcome ``  ·  `` too_much ``  |  `` choice === "charge" && typed! > cap ``  |  `` `At most ${money(cap)}.` ``  | [lib/server/holds.ts:1912](../src/lib/server/holds.ts#L1912) |
|  `` chooseOutcome ``  ·  `` too_small ``  |  `` choice === "charge" && typed! > 0 && typed! < 50 ``  |  `` The smallest card charge is $0.50. ``  | [lib/server/holds.ts:1913](../src/lib/server/holds.ts#L1913) |
|  `` chooseOutcome ``  ·  `` tick ``  |  `` choice === "charge" && amount > CHARGE_TICK_CENTS && body.tickedCents !== amount ``  |  `` `Tick “${chargeTickLabel(devName, cents)}” to charge.` ``  · [lib/rules.ts:52](../src/lib/rules.ts#L52) | [lib/server/holds.ts:1916](../src/lib/server/holds.ts#L1916) |
|  `` chooseOutcome ``  ·  `` done ``  |  `` !review ``  |  `` This was already settled. ``  | [lib/server/holds.ts:1919](../src/lib/server/holds.ts#L1919) |
|  `` chooseOutcome ``  ·  `` payment_unknown ``  |  `` e instanceof HttpError && e.code === "payment_unknown" ``  |  `` We didn't hear back from the payment service, so this payment is being checked. Within 15 minutes it shows as paid, or it's back here to pay again. Don't pay it twice: it's never charged twice. ``  · [lib/server/recovery.ts:21](../src/lib/server/recovery.ts#L21) | [lib/server/holds.ts:1950](../src/lib/server/holds.ts#L1950) |
|  `` chooseOutcome ``  ·  `` payments_problem ``  |  `` !(e instanceof HttpError && e.code === "card_failed") → else e instanceof HttpError && e.code !== "no_card" ``  |  `` Payments are having a problem right now. Nothing was charged; try again shortly. ``  · [lib/server/stripe.ts:297](../src/lib/server/stripe.ts#L297) | [lib/server/holds.ts:1956](../src/lib/server/holds.ts#L1956) |
|  `` claimChoice ``  ·  `` locked ``  |  `` await tx.payment.findFirst({ where: { ...where, kind: { in: ["review", "call"] }, status: { in: ["pending", "needs_action", "needs_confirmation"] } } }) ``  |  `` A payment for this is being confirmed right now. ``  · [lib/rules.ts:1001](../src/lib/rules.ts#L1001) | [lib/server/holds.ts:1982](../src/lib/server/holds.ts#L1982) |
|  `` devPaidRefusal ``  ·  `` done ``  |  `` review && byTesterChoice(review.reason) ``  |  `` You already chose for this. ``  | [lib/server/holds.ts:2005](../src/lib/server/holds.ts#L2005) |
|  `` devPaidRefusal ``  ·  `` done ``  |  `` review?.rejected ``  |  `` `${devName} rejected this meanwhile.` ``  | [lib/server/holds.ts:2006](../src/lib/server/holds.ts#L2006) |
|  `` devPaidRefusal ``  ·  `` done ``  | See handler |  `` `${dev} paid ${moreCents && !payCents ? `${money(moreCents)} more` : `${money(payCents)}${moreCents ? ` and ${money(moreCents)} more` : ""}`} for this meanwhile${disputable ? ": you can dispute it if you think it should be more." : "."}` ``  · [lib/rules.ts:1688](../src/lib/rules.ts#L1688) | [lib/server/holds.ts:2014](../src/lib/server/holds.ts#L2014) |
|  `` chargeRefusals ``  ·  `` locked ``  |  `` locked && review && chargedByTester(review.reason) → own ``  |  `` `You already charged ${money(cents)} for ${what}. It's waiting for ${dev}'s bank.` ``  · [lib/rules.ts:1006](../src/lib/rules.ts#L1006) | [lib/server/holds.ts:2026](../src/lib/server/holds.ts#L2026) |
|  `` chargeRefusals ``  ·  `` locked ``  |  `` locked ``  |  `` A payment for this is being confirmed right now. ``  · [lib/rules.ts:1001](../src/lib/rules.ts#L1001) | [lib/server/holds.ts:2030](../src/lib/server/holds.ts#L2030) |
|  `` chargeCloseOutGate ``  ·  `` charge_closed ``  |  `` closedOut(at) ``  |  `` `Charge and Let it go closed on ${date}.` ``  · [lib/rules.ts:1932](../src/lib/rules.ts#L1932) | [lib/server/holds.ts:2036](../src/lib/server/holds.ts#L2036) |
|  `` chooseCallOutcome ``  ·  `` not_found ``  |  `` !x &#124;&#124; x.contractId !== contractId &#124;&#124; x.contract.testerId !== tester.id ``  |  `` That call doesn't exist. ``  | [lib/server/holds.ts:2042](../src/lib/server/holds.ts#L2042) |
|  `` chooseCallOutcome ``  ·  `` auto_charge ``  |  `` x.rateCents != null ``  |  `` This call is charged automatically, so there's nothing to choose. ``  · [lib/rules.ts:1524](../src/lib/rules.ts#L1524) | [lib/server/holds.ts:2047](../src/lib/server/holds.ts#L2047) |
|  `` chooseCallOutcome ``  ·  `` not_yet ``  |  `` !x.choiceOfferedAt ``  |  `` `You can choose once ${REVIEW_DAYS} days have passed since the call and your deadline has passed.` ``  | [lib/server/holds.ts:2050](../src/lib/server/holds.ts#L2050) |
|  `` chooseCallOutcome ``  ·  `` bad_choice ``  |  `` !choice ``  |  `` Choose Charge or Let it go. ``  | [lib/server/holds.ts:2058](../src/lib/server/holds.ts#L2058) |
|  `` chooseCallOutcome ``  ·  `` paid_in_full ``  |  `` cap === 0 && choice === "charge" ``  |  `` There's nothing left to charge for this call (the $500 for calls on this test is used). ``  | [lib/server/holds.ts:2060](../src/lib/server/holds.ts#L2060) |
|  `` chooseCallOutcome ``  ·  `` bad_amount ``  |  `` choice === "charge" && (typed == null &#124;&#124; typed <= 0) ``  |  `` Enter an amount like 5.00. ``  | [lib/server/holds.ts:2062](../src/lib/server/holds.ts#L2062) |
|  `` chooseCallOutcome ``  ·  `` too_much ``  |  `` choice === "charge" && typed! > cap ``  |  `` `At most ${money(cap)}.` ``  | [lib/server/holds.ts:2063](../src/lib/server/holds.ts#L2063) |
|  `` chooseCallOutcome ``  ·  `` too_small ``  |  `` choice === "charge" && typed! > 0 && typed! < 50 ``  |  `` The smallest card charge is $0.50. ``  | [lib/server/holds.ts:2064](../src/lib/server/holds.ts#L2064) |
|  `` chooseCallOutcome ``  ·  `` tick ``  |  `` choice === "charge" && amount > CHARGE_TICK_CENTS && body.tickedCents !== amount ``  |  `` `Tick “${chargeTickLabel(devName, cents)}” to charge.` ``  · [lib/rules.ts:52](../src/lib/rules.ts#L52) | [lib/server/holds.ts:2067](../src/lib/server/holds.ts#L2067) |
|  `` chooseCallOutcome ``  ·  `` done ``  |  `` !review ``  |  `` This was already settled. ``  | [lib/server/holds.ts:2071](../src/lib/server/holds.ts#L2071) |
|  `` chooseCallOutcome ``  ·  `` payment_unknown ``  |  `` e instanceof HttpError && e.code === "payment_unknown" ``  |  `` We didn't hear back from the payment service, so this payment is being checked. Within 15 minutes it shows as paid, or it's back here to pay again. Don't pay it twice: it's never charged twice. ``  · [lib/server/recovery.ts:21](../src/lib/server/recovery.ts#L21) | [lib/server/holds.ts:2099](../src/lib/server/holds.ts#L2099) |
|  `` chooseCallOutcome ``  ·  `` payments_problem ``  |  `` !(e instanceof HttpError && e.code === "card_failed") → else e instanceof HttpError && e.code !== "no_card" ``  |  `` Payments are having a problem right now. Nothing was charged; try again shortly. ``  · [lib/server/stripe.ts:297](../src/lib/server/stripe.ts#L297) | [lib/server/holds.ts:2104](../src/lib/server/holds.ts#L2104) |
|  `` refuseOwedInFlight ``  ·  `` owed_in_flight ``  |  `` cents != null ``  |  `` `Pay what you owe (${amount}) is waiting for your bank in another tab or window: finish that check, or cancel it.` ``  · [lib/bankNotice.ts:81](../src/lib/bankNotice.ts#L81) | [lib/server/holds.ts:2167](../src/lib/server/holds.ts#L2167) |

### `src/lib/server/http.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` fail ``  ·  `` response ``  | See handler |  `` { code, message, ...(data ?? {}) } ``  | [lib/server/http.ts:13](../src/lib/server/http.ts#L13) |
|  `` readJson ``  ·  `` bad_request ``  |  `` !type.includes("application/json") ``  |  `` Something went wrong sending that. Reload the page and try again. ``  | [lib/server/http.ts:18](../src/lib/server/http.ts#L18) |
|  `` readJson ``  ·  `` bad_origin ``  |  `` origin && !sameOrigin(req, origin) ``  |  `` That request came from another site, so it was blocked. ``  | [lib/server/http.ts:20](../src/lib/server/http.ts#L20) |
|  `` readJson ``  ·  `` too_large ``  |  `` len > limit ``  |  `` That's too much to send at once. Try sending less at once. ``  | [lib/server/http.ts:22](../src/lib/server/http.ts#L22) |
|  `` readJson ``  ·  `` too_large ``  |  `` text.length > limit ``  |  `` That's too much to send at once. Try sending less at once. ``  | [lib/server/http.ts:24](../src/lib/server/http.ts#L24) |
|  `` readJson ``  ·  `` bad_request ``  | See handler |  `` Something went wrong sending that. Reload the page and try again. ``  | [lib/server/http.ts:36](../src/lib/server/http.ts#L36) |
|  `` readText ``  ·  `` code ``  |  `` s.length > max ``  |  `` `Keep it to ${max.toLocaleString("en-US")} characters.` ``  | [lib/server/http.ts:79](../src/lib/server/http.ts#L79) |

### `src/lib/server/invites.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` inviteTesters ``  ·  `` none ``  |  `` !ids.length ``  |  `` Tick at least one tester. ``  | [lib/server/invites.ts:311](../src/lib/server/invites.ts#L311) |
|  `` inviteTesters ``  ·  `` refused ``  |  `` refusal ``  |  `` `This test was stopped${t.stoppedAt ? ` on ${fmt(t.stoppedAt)}` : ""}, so nobody can be invited.` ``  · [lib/rules.ts:1285](../src/lib/rules.ts#L1285)<br> `` `Joining closed on ${fmt(t.openUntil)} (Open until), so nobody can be invited.` ``  · [lib/rules.ts:1286](../src/lib/rules.ts#L1286)<br> `` This test is paused until the chargeback steps are done, so nobody can be invited. ``  · [lib/rules.ts:1287](../src/lib/rules.ts#L1287)<br> `` This test is paused until you pay what you owe, so nobody can be invited. ``  · [lib/rules.ts:1287](../src/lib/rules.ts#L1287)<br> `` This test isn't taking new testers, so nobody can be invited. ``  · [lib/rules.ts:1288](../src/lib/rules.ts#L1288)<br> `` `${t.title ?? "This test"} is full. Add spots to invite more people.` ``  · [lib/rules.ts:1290](../src/lib/rules.ts#L1290)<br> ``  ``  · [lib/rules.ts:1291](../src/lib/rules.ts#L1291) | [lib/server/invites.ts:320](../src/lib/server/invites.ts#L320) |
|  `` inviteTesters ``  ·  `` refused ``  |  `` raters.length && raters.length === ticked.length ``  |  `` `${raters.map((p) => displayName(p)).join(", ")} rated this test, so ${pr.subj} can't join it again.` ``  | [lib/server/invites.ts:331](../src/lib/server/invites.ts#L331) |
|  `` inviteTesters ``  ·  `` needs_none ``  |  `` body.anyway === true && !gaps.length ``  |  `` Everyone you ticked now meets this test's needs. Press Invite to send. ``  | [lib/server/invites.ts:387](../src/lib/server/invites.ts#L387) |
|  `` inviteTesters ``  ·  `` too_many_invites ``  |  `` invited.length → !TESTING_NO_LIMITS && sent + invited.length > INVITES_PER_DAY ``  |  `` `You can send up to ${INVITES_PER_DAY} invites a day. You have ${left} left today.` ``  · [lib/server/invites.ts:294](../src/lib/server/invites.ts#L294)<br> `` `You've sent ${INVITES_PER_DAY} invites today. You can invite more tomorrow.` ``  · [lib/server/invites.ts:294](../src/lib/server/invites.ts#L294) | [lib/server/invites.ts:425](../src/lib/server/invites.ts#L425) |
|  `` cancelInvite ``  ·  `` not_found ``  |  `` !inv &#124;&#124; inv.testId !== testId ``  |  `` That invite doesn't exist. ``  | [lib/server/invites.ts:460](../src/lib/server/invites.ts#L460) |
|  `` cancelInvite → gone ``  ·  `` gone ``  | See handler |  `` `${pronouns(tester?.pronoun).Subj} already joined.` ``  · [lib/server/invites.ts:473](../src/lib/server/invites.ts#L473)<br> `` This invite is no longer valid: it was re-sent on the new listing. ``  · [lib/server/invites.ts:473](../src/lib/server/invites.ts#L473)<br> `` This invite was already cancelled. ``  · [lib/server/invites.ts:473](../src/lib/server/invites.ts#L473) | [lib/server/invites.ts:473](../src/lib/server/invites.ts#L473) |

### `src/lib/server/joining.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` closedInvite ``  ·  `` invite_closed ``  | See handler |  `` This invite is no longer open. ``  · [lib/server/joining.ts:151](../src/lib/server/joining.ts#L151)<br> `` This test was stopped. ``  · [lib/server/joining.ts:146](../src/lib/server/joining.ts#L146)<br> `` `“${t.title}” closed to new testers on ${fmtDate(t.openUntil)}.` ``  · [lib/server/joining.ts:147](../src/lib/server/joining.ts#L147)<br> `` `“${t.title}” isn't taking new testers right now, so this invite was closed.` ``  · [lib/server/joining.ts:148](../src/lib/server/joining.ts#L148) | [lib/server/joining.ts:157](../src/lib/server/joining.ts#L157) |
|  `` replacedInvite ``  ·  `` invite_replaced ``  | See handler |  `` `${dev} changed the listing at ${at} and sent you a new invite on it. Press Join to join on it.` ``  · [lib/server/joining.ts:161](../src/lib/server/joining.ts#L161)<br> `` `${displayName(dev)} changed the listing at ${fmtTime(inv.updatedAt)}, and this invite closed.` ``  · [lib/server/joining.ts:176](../src/lib/server/joining.ts#L176) | [lib/server/joining.ts:176](../src/lib/server/joining.ts#L176) |
|  `` alreadyWaiting ``  ·  `` already_waiting ``  | See handler |  `` You already asked to rejoin this test in another tab. ``  · [lib/server/joining.ts:186](../src/lib/server/joining.ts#L186)<br> `` You already applied to join this test in another tab. ``  · [lib/server/joining.ts:186](../src/lib/server/joining.ts#L186) | [lib/server/joining.ts:186](../src/lib/server/joining.ts#L186) |
|  `` inviteBeforePress ``  ·  `` invited ``  |  `` seen && inv.createdAt <= seen ``  |  `` `${devName} invited you: press Join to join.` ``  | [lib/server/joining.ts:205](../src/lib/server/joining.ts#L205) |
|  `` join ``  ·  `` not_tester ``  |  `` !tester.isTester ``  |  `` Turn on “test apps, games and more” in your profile to join tests. ``  | [lib/server/joining.ts:211](../src/lib/server/joining.ts#L211) |
|  `` join ``  ·  `` not_found ``  |  `` !t ``  |  `` That test doesn't exist. ``  | [lib/server/joining.ts:213](../src/lib/server/joining.ts#L213) |
|  `` join ``  ·  `` refused ``  |  `` refusal ``  |  `` This test was stopped. ``  · [lib/server/joining.ts:40](../src/lib/server/joining.ts#L40)<br> `` This test isn't taking new testers any more. ``  · [lib/server/joining.ts:42](../src/lib/server/joining.ts#L42)<br> `` You've already joined this test. ``  · [lib/server/joining.ts:46](../src/lib/server/joining.ts#L46)<br> `` You can't join this test again. ``  · [lib/server/joining.ts:48](../src/lib/server/joining.ts#L48)<br> `` `You blocked ${displayName(t.developer)}: unblock ${pronouns(t.developer.pronoun).obj} in Account → Blocked people to join.` ``  · [lib/server/joining.ts:51](../src/lib/server/joining.ts#L51)<br> `` This test isn't taking new testers right now. ``  · [lib/server/joining.ts:52](../src/lib/server/joining.ts#L52)<br> ``  ``  · [lib/server/joining.ts:54](../src/lib/server/joining.ts#L54) | [lib/server/joining.ts:216](../src/lib/server/joining.ts#L216) |
|  `` join ``  ·  `` ask ``  |  `` gone && gone.status !== "working" && body.rejoinAccepted !== true && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } })) ``  |  `` You left this test, so you ask to rejoin and the developer accepts. ``  | [lib/server/joining.ts:220](../src/lib/server/joining.ts#L220) |
|  `` join ``  ·  `` apply ``  |  `` t.joinMode === "apply" && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } })) && !(await db.application.findFirst({ where: { testId, testerId: tester.id, status: "pending", changedAt: { not: null } } })) ``  |  `` This test takes applications: press Apply to join. ``  | [lib/server/joining.ts:225](../src/lib/server/joining.ts#L225) |
|  `` join ``  ·  `` invite_only ``  |  `` t.joinMode === "invite" && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } })) ``  |  `` This test is invite only. ``  | [lib/server/joining.ts:227](../src/lib/server/joining.ts#L227) |
|  `` saveJoinRequest ``  ·  `` waiting ``  |  `` previous?.status==="pending" ``  |  `` You already have a request waiting for this test. ``  | [lib/server/joining.ts:239](../src/lib/server/joining.ts#L239) |
|  `` saveJoinRequest ``  ·  `` too_many_requests ``  |  `` !TESTING_NO_LIMITS&&!bypassLimit&&previous && await tx.testEvent.count({where:{testId,kind:"applied",link:`item-app-${previous.id}`,createdAt:{gt:new Date(Date.now()-24*3600000)}}})>=JOIN_REQUESTS_PER_TEST_PER_DAY ``  |  `` You can apply or ask to rejoin this test twice in 24 hours. Try again later. ``  | [lib/server/joining.ts:240](../src/lib/server/joining.ts#L240) |
|  `` apply ``  ·  `` not_tester ``  |  `` !tester.isTester ``  |  `` Turn on “test apps, games and more” in your profile to join tests. ``  | [lib/server/joining.ts:249](../src/lib/server/joining.ts#L249) |
|  `` apply ``  ·  `` not_found ``  |  `` !t ``  |  `` That test doesn't exist. ``  | [lib/server/joining.ts:251](../src/lib/server/joining.ts#L251) |
|  `` apply ``  ·  `` refused ``  |  `` refusal ``  |  `` This test was stopped. ``  · [lib/server/joining.ts:40](../src/lib/server/joining.ts#L40)<br> `` This test isn't taking new testers any more. ``  · [lib/server/joining.ts:42](../src/lib/server/joining.ts#L42)<br> `` You've already joined this test. ``  · [lib/server/joining.ts:46](../src/lib/server/joining.ts#L46)<br> `` You can't join this test again. ``  · [lib/server/joining.ts:48](../src/lib/server/joining.ts#L48)<br> `` `You blocked ${displayName(t.developer)}: unblock ${pronouns(t.developer.pronoun).obj} in Account → Blocked people to join.` ``  · [lib/server/joining.ts:51](../src/lib/server/joining.ts#L51)<br> `` This test isn't taking new testers right now. ``  · [lib/server/joining.ts:52](../src/lib/server/joining.ts#L52)<br> ``  ``  · [lib/server/joining.ts:54](../src/lib/server/joining.ts#L54) | [lib/server/joining.ts:254](../src/lib/server/joining.ts#L254) |
|  `` apply ``  ·  `` profile_first ``  |  `` !profileSaved(await db.testerProfile.findUnique({ where: { userId: tester.id } })) ``  |  `` Save your tester profile first: pick the devices and languages you test on in Profile. ``  · [lib/server/tests.ts:1042](../src/lib/server/tests.ts#L1042) | [lib/server/joining.ts:260](../src/lib/server/joining.ts#L260) |
|  `` apply ``  ·  `` invite_only ``  |  `` t.joinMode === "invite" ``  |  `` This test is invite only. ``  | [lib/server/joining.ts:264](../src/lib/server/joining.ts#L264) |
|  `` apply ``  ·  `` nda ``  |  `` t.ndaText && body.ndaAccepted !== true ``  |  `` Accept the NDA to apply. ``  | [lib/server/joining.ts:268](../src/lib/server/joining.ts#L268) |
|  `` withdrawApplication ``  ·  `` gone ``  |  `` !n.count ``  |  `` There's no pending application to withdraw. ``  · [lib/server/joining.ts:290](../src/lib/server/joining.ts#L290)<br> `` `${dev} accepted your application at ${at}, so you're in this test.` ``  · [lib/server/joining.ts:302](../src/lib/server/joining.ts#L302)<br> `` `${dev} declined your application at ${at}.` ``  · [lib/server/joining.ts:303](../src/lib/server/joining.ts#L303)<br> `` `You withdrew it in another tab at ${at}.` ``  · [lib/server/joining.ts:304](../src/lib/server/joining.ts#L304)<br> `` `It closed when ${dev} changed the listing at ${at}. You can apply again.` ``  · [lib/server/joining.ts:305](../src/lib/server/joining.ts#L305) | [lib/server/joining.ts:278](../src/lib/server/joining.ts#L278) |
|  `` decideApplication ``  ·  `` not_found ``  |  `` !a &#124;&#124; a.testId !== testId ``  |  `` That application doesn't exist. ``  | [lib/server/joining.ts:316](../src/lib/server/joining.ts#L316) |
|  `` decideApplication → gone ``  ·  `` gone ``  |  `` a.status === "closed" && a.closedReason === "full" ``  |  `` `${name}'s application closed when the test filled up at ${fmtTime(a.decidedAt ?? new Date())}.` ``  | [lib/server/joining.ts:321](../src/lib/server/joining.ts#L321) |
|  `` decideApplication → gone ``  ·  `` gone ``  |  `` a.status === "closed" && a.closedReason === "blocked" ``  |  `` `${name}'s application was closed.` ``  | [lib/server/joining.ts:323](../src/lib/server/joining.ts#L323) |
|  `` decideApplication → gone ``  ·  `` gone ``  |  `` a.status === "closed" ``  |  `` `${name}'s application closed when the test became invite only at ${fmtTime(a.decidedAt ?? new Date())}.` ``  · [lib/server/joining.ts:324](../src/lib/server/joining.ts#L324)<br> `` `${name}'s application closed when you changed the listing in another tab at ${fmtTime(a.decidedAt ?? new Date())}.` ``  · [lib/server/joining.ts:324](../src/lib/server/joining.ts#L324) | [lib/server/joining.ts:324](../src/lib/server/joining.ts#L324) |
|  `` decideApplication → gone ``  ·  `` gone ``  | See handler |  `` `${name} withdrew ${pronouns(tester.pronoun).poss} application.` ``  · [lib/server/joining.ts:326](../src/lib/server/joining.ts#L326)<br> `` You already declined this application. ``  · [lib/server/joining.ts:326](../src/lib/server/joining.ts#L326)<br> `` You already accepted this application. ``  · [lib/server/joining.ts:326](../src/lib/server/joining.ts#L326)<br> `` This application was already answered. ``  · [lib/server/joining.ts:326](../src/lib/server/joining.ts#L326) | [lib/server/joining.ts:326](../src/lib/server/joining.ts#L326) |
|  `` decideApplication ``  ·  `` refused ``  |  `` refusal ``  |  `` refusal.replace("You've already joined", `${name} already joined`).replace(TEST_LIMIT_LINE, `${name} can't join more tests right now.`) ``  | [lib/server/joining.ts:359](../src/lib/server/joining.ts#L359) |
|  `` askToRejoin ``  ·  `` not_tester ``  |  `` !tester.isTester ``  |  `` Turn on “test apps, games and more” in your profile to join tests. ``  | [lib/server/joining.ts:447](../src/lib/server/joining.ts#L447) |
|  `` askToRejoin ``  ·  `` not_found ``  |  `` !t ``  |  `` That test doesn't exist. ``  | [lib/server/joining.ts:449](../src/lib/server/joining.ts#L449) |
|  `` askToRejoin ``  ·  `` not_again ``  |  `` !old &#124;&#124; old.status === "working" ``  |  `` You've already joined this test. ``  · [lib/server/joining.ts:452](../src/lib/server/joining.ts#L452)<br> `` You haven't been in this test. ``  · [lib/server/joining.ts:452](../src/lib/server/joining.ts#L452) | [lib/server/joining.ts:452](../src/lib/server/joining.ts#L452) |
|  `` askToRejoin ``  ·  `` refused ``  |  `` await blocks.blockedEitherWay(tester.id, t.developerId) ``  |  `` This test isn't taking new testers right now. ``  · [lib/server/blocks.ts:24](../src/lib/server/blocks.ts#L24) | [lib/server/joining.ts:455](../src/lib/server/joining.ts#L455) |
|  `` askToRejoin ``  ·  `` not_again ``  |  `` !canAskToRejoin(old, rated) ``  |  `` You rated this test, so you can't join it again. ``  · [lib/server/joining.ts:456](../src/lib/server/joining.ts#L456)<br> `` You can't ask to rejoin this test. ``  · [lib/server/joining.ts:456](../src/lib/server/joining.ts#L456) | [lib/server/joining.ts:456](../src/lib/server/joining.ts#L456) |
|  `` askToRejoin ``  ·  `` refused ``  |  `` refusal ``  |  `` This test was stopped. ``  · [lib/server/joining.ts:40](../src/lib/server/joining.ts#L40)<br> `` This test isn't taking new testers any more. ``  · [lib/server/joining.ts:42](../src/lib/server/joining.ts#L42)<br> `` You've already joined this test. ``  · [lib/server/joining.ts:46](../src/lib/server/joining.ts#L46)<br> `` You can't join this test again. ``  · [lib/server/joining.ts:48](../src/lib/server/joining.ts#L48)<br> `` `You blocked ${displayName(t.developer)}: unblock ${pronouns(t.developer.pronoun).obj} in Account → Blocked people to join.` ``  · [lib/server/joining.ts:51](../src/lib/server/joining.ts#L51)<br> `` This test isn't taking new testers right now. ``  · [lib/server/joining.ts:52](../src/lib/server/joining.ts#L52)<br> ``  ``  · [lib/server/joining.ts:54](../src/lib/server/joining.ts#L54) | [lib/server/joining.ts:458](../src/lib/server/joining.ts#L458) |
|  `` askToRejoin ``  ·  `` profile_first ``  |  `` !profileSaved(await db.testerProfile.findUnique({ where: { userId: tester.id } })) ``  |  `` Save your tester profile first: pick the devices and languages you test on in Profile. ``  · [lib/server/tests.ts:1042](../src/lib/server/tests.ts#L1042) | [lib/server/joining.ts:462](../src/lib/server/joining.ts#L462) |
|  `` askToRejoin ``  ·  `` nda ``  |  `` t.ndaText && body.ndaAccepted !== true ``  |  `` Accept the NDA to ask to rejoin. ``  | [lib/server/joining.ts:464](../src/lib/server/joining.ts#L464) |

### `src/lib/server/kept.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` checkKey ``  ·  `` bad_key ``  |  `` typeof key !== "string" &#124;&#124; key.length > 160 &#124;&#124; !/^[A-Za-z0-9:_.-]+$/.test(key) &#124;&#124; !KINDS.some((k) => key.startsWith(k)) ``  |  `` That form isn't kept. ``  | [lib/server/kept.ts:21](../src/lib/server/kept.ts#L21) |
|  `` checkAdminKey ``  ·  `` not_admin ``  |  `` !u &#124;&#124; !isAdmin(u) ``  |  `` Only admins can do that. ``  | [lib/server/kept.ts:29](../src/lib/server/kept.ts#L29) |
|  `` setKept ``  ·  `` too_big ``  |  `` JSON.stringify(data).length > MAX_BYTES ``  |  `` That's too much to keep. ``  | [lib/server/kept.ts:48](../src/lib/server/kept.ts#L48) |
|  `` patchKept ``  ·  `` bad_key ``  |  `` !keptByUnit(k) ``  |  `` That form isn't kept by field. ``  | [lib/server/kept.ts:83](../src/lib/server/kept.ts#L83) |
|  `` patchKept ``  ·  `` bad_units ``  |  `` !units &#124;&#124; typeof units !== "object" &#124;&#124; Array.isArray(units) ``  |  `` Nothing to keep. ``  | [lib/server/kept.ts:84](../src/lib/server/kept.ts#L84) |
|  `` patchKept ``  ·  `` too_big ``  |  `` JSON.stringify(next).length > MAX_BYTES ``  |  `` That's too much to keep. ``  | [lib/server/kept.ts:95](../src/lib/server/kept.ts#L95) |

### `src/lib/server/messages.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` chatAccess ``  ·  `` not_found ``  |  `` !test &#124;&#124; (userId !== testerId && userId !== test.developerId) &#124;&#124; testerId === test.developerId ``  |  `` That chat doesn't exist. ``  | [lib/server/messages.ts:17](../src/lib/server/messages.ts#L17) |
|  `` chatAccess ``  ·  `` not_found ``  |  `` !contract ``  |  `` That chat doesn't exist. ``  | [lib/server/messages.ts:20](../src/lib/server/messages.ts#L20) |
|  `` openTesterChat ``  ·  `` not_found ``  |  `` !c &#124;&#124; (c.test.developerId !== who.id && c.testerId !== who.id) ``  |  `` That chat doesn't exist. ``  | [lib/server/messages.ts:50](../src/lib/server/messages.ts#L50) |
|  `` openTesterChat ``  ·  `` unable ``  |  `` c.testerId === who.id → !a &#124;&#124; a.blocked &#124;&#124; who.testerSuspendedAt ``  |  `` Unable to chat with this developer. ``  · [lib/server/messages.ts:47](../src/lib/server/messages.ts#L47) | [lib/server/messages.ts:55](../src/lib/server/messages.ts#L55) |
|  `` openTesterChat ``  ·  `` unable ``  |  `` else c.testerId === who.id → !a &#124;&#124; a.blocked &#124;&#124; who.devSuspendedAt &#124;&#124; who.holdStartedAt &#124;&#124; teamPausedNow(c.test) ``  |  `` Unable to chat with this tester. ``  · [lib/server/messages.ts:28](../src/lib/server/messages.ts#L28) | [lib/server/messages.ts:56](../src/lib/server/messages.ts#L56) |
|  `` chatFor ``  ·  `` not_found ``  |  `` !c &#124;&#124; (c.testerId !== userId && c.test.developerId !== userId) ``  |  `` That chat doesn't exist. ``  | [lib/server/messages.ts:63](../src/lib/server/messages.ts#L63) |
|  `` sendChat ``  ·  `` closed ``  |  `` a.blocked ``  |  `` This chat is closed. ``  | [lib/server/messages.ts:81](../src/lib/server/messages.ts#L81) |
|  `` sendChat ``  ·  `` admin_paused ``  |  `` iAmDev && r.teamPaused && !r.dev.devSuspendedAt && !r.dev.holdStartedAt ``  |  `` The team paused this test: you can stop it, end testers' work early, cancel calls, or add your side of a dispute. ``  · [lib/restricted.ts:65](../src/lib/restricted.ts#L65) | [lib/server/messages.ts:93](../src/lib/server/messages.ts#L93) |
|  `` sendChat ``  ·  `` iAmDev && !r.dev.devSuspendedAt ? "held" : "suspended" ``  |  `` iAmDev ? r.developer : r.tester ``  |  `` Your tests are paused. ``  · [lib/server/messages.ts:94](../src/lib/server/messages.ts#L94)<br> `` Your account is paused. ``  · [lib/server/messages.ts:94](../src/lib/server/messages.ts#L94) | [lib/server/messages.ts:94](../src/lib/server/messages.ts#L94) |
|  `` sendChat ``  ·  `` chat_paused ``  |  `` iAmDev ? r.tester : r.developer ``  |  `` Messages are paused for now, so this wasn't sent. ``  · [lib/rules.ts:931](../src/lib/rules.ts#L931) | [lib/server/messages.ts:95](../src/lib/server/messages.ts#L95) |
|  `` sendChat ``  ·  `` empty ``  |  `` !body ``  |  `` Type a message first. ``  | [lib/server/messages.ts:97](../src/lib/server/messages.ts#L97) |
|  `` sendChat ``  ·  `` too_fast ``  |  `` counts[0] + counts[1] >= CHAT_PER_MINUTE ``  |  `` You're sending messages very fast. Wait a minute, then send again. ``  · [lib/server/messages.ts:73](../src/lib/server/messages.ts#L73) | [lib/server/messages.ts:100](../src/lib/server/messages.ts#L100) |
|  `` sendChat ``  ·  `` too_long ``  |  `` body.length > CHAT_MAX ``  |  `` `Keep a message to ${CHAT_MAX.toLocaleString("en-US")} characters.` ``  | [lib/server/messages.ts:101](../src/lib/server/messages.ts#L101) |

### `src/lib/server/outages.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` approveGap ``  ·  `` done ``  | See handler |  `` An outage is already recorded from that time. ``  | [lib/server/outages.ts:153](../src/lib/server/outages.ts#L153) |
|  `` gapDone ``  ·  `` done ``  |  `` !last ``  |  `` That possible outage was already approved or dismissed. ``  | [lib/server/outages.ts:186](../src/lib/server/outages.ts#L186) |
|  `` gapDone ``  ·  `` done ``  | See handler |  `` await race.alreadyLine(p, last.adminId, last.createdAt, (who) => `That possible outage was already ${did} ${race.byAt(who, last.createdAt)}.`, `${did} this possible outage`) ``  | [lib/server/outages.ts:188](../src/lib/server/outages.ts#L188) |

### `src/lib/server/owedOnce.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` dropCheck ``  ·  `` payments_problem ``  | See handler |  `` Payments are having a problem right now. Nothing was charged; try again shortly. ``  · [lib/server/stripe.ts:297](../src/lib/server/stripe.ts#L297) | [lib/server/owedOnce.ts:64](../src/lib/server/owedOnce.ts#L64) |
|  `` claimOwed ``  ·  `` review_first ``  |  `` opts.reviewFirst → u.holdStartedAt && u.holdReason === "chargeback" && !u.chargebackApprovedAt ``  |  `` `Your account has had ${n} chargebacks: the team reviews it before you can pay. You'll get an email when you can.` ``  · [lib/rules.ts:1179](../src/lib/rules.ts#L1179) | [lib/server/owedOnce.ts:108](../src/lib/server/owedOnce.ts#L108) |
|  `` chargeClaimed ``  ·  `` card_failed ``  |  `` stripeOn() && (!u.stripeCustomerId &#124;&#124; !u.stripePaymentMethodId) ``  |  `` No card is saved on this account. ``  | [lib/server/owedOnce.ts:240](../src/lib/server/owedOnce.ts#L240) |
|  `` cancelOwedCheck ``  ·  `` not_found ``  |  `` !p &#124;&#124; p.developerId !== devId ``  |  `` There's no bank check waiting here. ``  · [lib/rules.ts:965](../src/lib/rules.ts#L965) | [lib/server/owedOnce.ts:333](../src/lib/server/owedOnce.ts#L333) |
|  `` cancelOwedCheck ``  ·  `` confirmed ``  |  `` !p.actionPi → p.status === OWED_PAID ``  |  `` Your bank already confirmed this payment: it's paid. ``  · [lib/rules.ts:964](../src/lib/rules.ts#L964) | [lib/server/owedOnce.ts:335](../src/lib/server/owedOnce.ts#L335) |
|  `` cancelOwedCheck ``  ·  `` cancelled ``  |  `` !p.actionPi → await cancelledBefore(devId, p.id) ``  |  `` You already cancelled this check. ``  · [lib/rules.ts:967](../src/lib/rules.ts#L967) | [lib/server/owedOnce.ts:336](../src/lib/server/owedOnce.ts#L336) |
|  `` cancelOwedCheck ``  ·  `` busy ``  |  `` !p.actionPi → p.kind === OWED_KIND && p.status === "paying" ``  |  `` This payment is going through right now. Try again shortly. ``  | [lib/server/owedOnce.ts:337](../src/lib/server/owedOnce.ts#L337) |
|  `` cancelOwedCheck ``  ·  `` no_check ``  |  `` !p.actionPi ``  |  `` There's no bank check waiting here. ``  · [lib/rules.ts:965](../src/lib/rules.ts#L965) | [lib/server/owedOnce.ts:338](../src/lib/server/owedOnce.ts#L338) |
|  `` cancelOwedCheck ``  ·  `` cancelled ``  |  `` !(await claimCancel(p, end !== "succeeded")) → await cancelledBefore(devId, p.id) ``  |  `` You already cancelled this check. ``  · [lib/rules.ts:967](../src/lib/rules.ts#L967) | [lib/server/owedOnce.ts:344](../src/lib/server/owedOnce.ts#L344) |
|  `` cancelOwedCheck ``  ·  `` confirmed ``  |  `` !(await claimCancel(p, end !== "succeeded")) ``  |  `` Your bank already confirmed this payment: it's paid. ``  · [lib/rules.ts:964](../src/lib/rules.ts#L964) | [lib/server/owedOnce.ts:345](../src/lib/server/owedOnce.ts#L345) |

### `src/lib/server/passwords.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` field ``  ·  `` bad_field ``  | See handler |  `` message ``  · [lib/server/passwords.ts:26](../src/lib/server/passwords.ts#L26) | [lib/server/passwords.ts:26](../src/lib/server/passwords.ts#L26) |
|  `` networkLimit ``  ·  `` too_many ``  |  `` (await db.loginAttempt.count({ where: { kind, ip, at: { gt: new Date(now.getTime() - windowMs) } } })) >= max ``  |  `` message ``  · [lib/server/passwords.ts:81](../src/lib/server/passwords.ts#L81) | [lib/server/passwords.ts:83](../src/lib/server/passwords.ts#L83) |
|  `` signUp ``  ·  `` too_many ``  |  `` ip && (await db.loginAttempt.count({ where: { kind: "signup", ok: true, ip, at: { gt: new Date(now.getTime() - 3_600_000) } } })) >= SIGNUPS_PER_NETWORK_HOUR ``  |  `` Too many new accounts from here. Try again in an hour. ``  · [lib/server/passwords.ts:65](../src/lib/server/passwords.ts#L65) | [lib/server/passwords.ts:188](../src/lib/server/passwords.ts#L188) |
|  `` logIn ``  ·  `` too_many ``  |  `` await loginPaused(email, ip, now) ``  |  `` Too many tries. Wait 15 minutes or reset your password. ``  · [lib/server/passwords.ts:64](../src/lib/server/passwords.ts#L64) | [lib/server/passwords.ts:214](../src/lib/server/passwords.ts#L214) |
|  `` resetPassword ``  ·  `` bad_link ``  | See handler |  `` This link has expired or was already used. Ask for a new one. ``  | [lib/server/passwords.ts:265](../src/lib/server/passwords.ts#L265) |
|  `` sendVerification ``  ·  `` confirmed ``  |  `` user.emailVerifiedAt ``  |  `` Your email is already confirmed. ``  | [lib/server/passwords.ts:301](../src/lib/server/passwords.ts#L301) |
|  `` sendVerification ``  ·  `` rate_limited ``  |  `` (await recentlySent(user.email, "verify")) >= EMAILS_PER_HOUR ``  |  `` We've sent a few already: check your inbox (and spam), or try again in an hour ``  | [lib/server/passwords.ts:302](../src/lib/server/passwords.ts#L302) |

### `src/lib/server/pauseClosure.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` closePausedTest ``  ·  `` not_found ``  |  `` !t ``  |  `` That test doesn't exist. ``  | [lib/server/pauseClosure.ts:23](../src/lib/server/pauseClosure.ts#L23) |
|  `` closePausedTest ``  ·  `` stopped ``  |  `` t.status === "stopped" ``  |  `` That test was already stopped. ``  | [lib/server/pauseClosure.ts:25](../src/lib/server/pauseClosure.ts#L25) |
|  `` closePausedTest ``  ·  `` not_paused ``  |  `` !info ``  |  `` That test isn't paused. ``  | [lib/server/pauseClosure.ts:26](../src/lib/server/pauseClosure.ts#L26) |
|  `` adminClosePaused ``  ·  `` not_found ``  |  `` !t ``  |  `` That test doesn't exist. ``  | [lib/server/pauseClosure.ts:61](../src/lib/server/pauseClosure.ts#L61) |
|  `` adminClosePaused ``  ·  `` not_paused ``  |  `` !pauseClosesAt(t.developer, t) → else seen ``  |  `` That test isn't paused. ``  | [lib/server/pauseClosure.ts:64](../src/lib/server/pauseClosure.ts#L64) |
|  `` extendPauseClosure ``  ·  `` bad_days ``  |  `` !Number.isFinite(n) &#124;&#124; n < 1 &#124;&#124; n > 90 &#124;&#124; Math.floor(n) !== n ``  |  `` Enter a whole number of days from 1 to 90. ``  | [lib/server/pauseClosure.ts:94](../src/lib/server/pauseClosure.ts#L94) |
|  `` extendPauseClosure ``  ·  `` not_found ``  |  `` !t ``  |  `` That test doesn't exist. ``  | [lib/server/pauseClosure.ts:96](../src/lib/server/pauseClosure.ts#L96) |
|  `` extendPauseClosure ``  ·  `` not_paused ``  |  `` !info → else seen ``  |  `` That test isn't paused. ``  | [lib/server/pauseClosure.ts:101](../src/lib/server/pauseClosure.ts#L101) |

### `src/lib/server/payments.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` loadPiece ``  ·  `` cancelled ``  |  `` kind === "call" → c.status === "cancelled" ``  |  `` This call was cancelled, so there's nothing to pay. ``  | [lib/server/payments.ts:52](../src/lib/server/payments.ts#L52) |
|  `` loadPiece ``  ·  `` not_yet ``  |  `` kind === "call" → c.startsAt > new Date() ``  |  `` You can pay for this call once it has started. ``  | [lib/server/payments.ts:53](../src/lib/server/payments.ts#L53) |
|  `` loadPiece ``  ·  `` measuring ``  |  `` kind === "call" → minutes == null ``  |  `` This call is still being measured: you can pay it once its length is final. ``  · [lib/server/calls.ts:121](../src/lib/server/calls.ts#L121) | [lib/server/payments.ts:56](../src/lib/server/payments.ts#L56) |
|  `` review ``  ·  `` no_reject ``  |  `` body.action === "reject" ``  |  `` There's no Reject: pay any amount, $0 included (say why at $0). ``  · [lib/server/payments.ts:642](../src/lib/server/payments.ts#L642) | [lib/server/payments.ts:70](../src/lib/server/payments.ts#L70) |
|  `` review ``  ·  `` bad_request ``  |  `` !payKey ``  |  `` This page is out of date. ``  | [lib/server/payments.ts:74](../src/lib/server/payments.ts#L74) |
|  `` review ``  ·  `` devNow.devSuspendedAt ? "suspended" : "held" ``  |  `` devNow.devSuspendedAt &#124;&#124; devNow.holdStartedAt ``  |  `` Your account is suspended: Pay waits until it is lifted. ``  · [lib/server/payments.ts:89](../src/lib/server/payments.ts#L89)<br> `` Pay what you owe first. ``  · [lib/rules.ts:949](../src/lib/rules.ts#L949) | [lib/server/payments.ts:89](../src/lib/server/payments.ts#L89) |
|  `` review ``  ·  `` not_found ``  |  `` !piece &#124;&#124; piece.contract.test.developerId !== dev.id ``  |  `` That work doesn't exist or isn't on your test. ``  | [lib/server/payments.ts:93](../src/lib/server/payments.ts#L93) |
|  `` review ``  ·  `` gone ``  |  `` !testerPayable(c.tester) && !(await tx.review.findFirst({ where: piece.where })) ``  |  `` `${name} deleted ${pronouns(pronoun).poss} account before setting up payouts, so this can't be paid.` ``  · [lib/rules.ts:1038](../src/lib/rules.ts#L1038) | [lib/server/payments.ts:102](../src/lib/server/payments.ts#L102) |
|  `` review ``  ·  `` bank_waits ``  |  `` already → waits ``  |  `` waits ``  · [lib/server/payments.ts:109](../src/lib/server/payments.ts#L109) | [lib/server/payments.ts:110](../src/lib/server/payments.ts#L110) |
|  `` review ``  ·  `` reviewed ``  |  `` already → mine → mine.text.startsWith("rejected ") ``  |  `` `You already rejected ${name}'s ${piece.reference} in another tab at ${at}.` ``  | [lib/server/payments.ts:117](../src/lib/server/payments.ts#L117) |
|  `` review ``  ·  `` reviewed ``  |  `` already → mine → mine.text.startsWith("confirmed ") ``  |  `` `You already ${mine.text} in another tab at ${at}.` ``  | [lib/server/payments.ts:118](../src/lib/server/payments.ts#L118) |
|  `` review ``  ·  `` reviewed ``  |  `` already → mine ``  |  `` `You already paid ${money(already.amountCents)} for ${name}'s ${piece.reference} in another tab at ${at}.` ``  | [lib/server/payments.ts:119](../src/lib/server/payments.ts#L119) |
|  `` review ``  ·  `` reviewed ``  |  `` already → chargedByTester(already.reason) ``  |  `` `${name} already charged ${money(already.amountCents)} for ${pronouns(c.tester.pronoun).poss} ${piece.reference}.` ``  | [lib/server/payments.ts:124](../src/lib/server/payments.ts#L124) |
|  `` review ``  ·  `` reviewed ``  |  `` already → already.reason === LET_GO_BY_TESTER ``  |  `` `${name} let ${pronouns(c.tester.pronoun).poss} ${piece.reference} go: nothing was charged.` ``  | [lib/server/payments.ts:125](../src/lib/server/payments.ts#L125) |
|  `` review ``  ·  `` reviewed ``  |  `` already → already.teamClosedById ``  |  `` The team closed this for $0. ``  · [lib/moneyLines.ts:51](../src/lib/moneyLines.ts#L51) | [lib/server/payments.ts:126](../src/lib/server/payments.ts#L126) |
|  `` review ``  ·  `` reviewed ``  |  `` already → already.reason === UNLISTED_CALL_CLOSED ``  |  `` `${call} closed with nothing paid: it wasn't listed and wasn't paid within ${REVIEW_DAYS} days.` ``  · [lib/rules.ts:1522](../src/lib/rules.ts#L1522) | [lib/server/payments.ts:127](../src/lib/server/payments.ts#L127) |
|  `` review ``  ·  `` owed ``  |  `` already → owedNow ``  |  `` `This ${money(already.amountCents)} is owed: pay it with “Pay what you owe” in Payments.` ``  | [lib/server/payments.ts:129](../src/lib/server/payments.ts#L129) |
|  `` review ``  ·  `` reviewed ``  |  `` already ``  |  `` `You already rejected ${name}'s ${piece.reference}.` ``  · [lib/server/payments.ts:130](../src/lib/server/payments.ts#L130)<br> `` `You already paid ${money(already.amountCents)} for ${name}'s ${piece.reference}.` ``  · [lib/server/payments.ts:130](../src/lib/server/payments.ts#L130) | [lib/server/payments.ts:130](../src/lib/server/payments.ts#L130) |
|  `` review ``  ·  `` locked ``  |  `` await tx.payment.count({ where: { ...piece.where, kind: { in: ["review", "call"] }, status: { in: ["pending", "needs_action"] } } }) ``  |  `` A payment for this part is being confirmed. Wait for it to finish before paying again. ``  | [lib/server/payments.ts:132](../src/lib/server/payments.ts#L132) |
|  `` review ``  ·  `` pay_closed ``  |  `` closedOut(at) ``  |  `` `${more ? "Pay more" : "Pay"} closed on ${date}.` ``  · [lib/rules.ts:1930](../src/lib/rules.ts#L1930) | [lib/server/payments.ts:137](../src/lib/server/payments.ts#L137) |
|  `` review ``  ·  `` owed_first ``  |  `` await devOwes(dev.id) ``  |  `` Pay what you owe first. ``  · [lib/rules.ts:949](../src/lib/rules.ts#L949) | [lib/server/payments.ts:139](../src/lib/server/payments.ts#L139) |
|  `` review ``  ·  `` bad_amount ``  |  `` !check.ok ``  |  `` check.message ``  · [lib/rules.ts:73](../src/lib/rules.ts#L73) | [lib/server/payments.ts:145](../src/lib/server/payments.ts#L145) |
|  `` review ``  ·  `` bad_rate ``  |  `` piece.kind === "call" && rateCents != null → rateCents < 0 ``  |  `` Enter a rate like 30.00. ``  | [lib/server/payments.ts:147](../src/lib/server/payments.ts#L147) |
|  `` review ``  ·  `` over_cap ``  |  `` piece.kind === "call" && rateCents != null → piece.listing == null && rateCents > NO_LISTING_CALL_RATE_CAP_CENTS ``  |  `` A call that isn't listed can be paid at most $200 an hour. ``  | [lib/server/payments.ts:148](../src/lib/server/payments.ts#L148) |
|  `` review ``  ·  `` over_cap ``  |  `` amountCents! > room.roomCents ``  |  `` `This is more than you can pay for this call (up to ${money(roomCents)}: what's left of the ${dollars(CALLS_TOTAL_CENTS)} for calls on this test).` ``  · [lib/callMeasure.ts:109](../src/lib/callMeasure.ts#L109)<br> `` `This is more than you can pay for this call (up to ${money(roomCents)} at ${money(NO_LISTING_CALL_RATE_CAP_CENTS).replace(/\.00$/, "")} an hour).` ``  · [lib/rules.ts:1953](../src/lib/rules.ts#L1953)<br> `` `Paid the most this piece can be paid (${money(cents)}).` ``  · [lib/rules.ts:1963](../src/lib/rules.ts#L1963)<br> `` `This is more than this piece can be paid (up to ${money(roomCents).replace(/\.00$/, "")}${roomCents < totalCents ? ` more, ${money(totalCents).replace(/\.00$/, "")} in all` : ""}).` ``  · [lib/rules.ts:1972](../src/lib/rules.ts#L1972) | [lib/server/payments.ts:154](../src/lib/server/payments.ts#L154) |
|  `` review ``  ·  `` no_card ``  |  `` card ``  |  ``  ``  · [lib/server/payments.ts:156](../src/lib/server/payments.ts#L156) | [lib/server/payments.ts:157](../src/lib/server/payments.ts#L157) |
|  `` review ``  ·  `` payment_unknown ``  |  `` e instanceof HttpError && e.code === "payment_unknown" ``  |  `` We didn't hear back from the payment service, so this payment is being checked. Within 15 minutes it shows as paid, or it's back here to pay again. Don't pay it twice: it's never charged twice. ``  · [lib/server/recovery.ts:21](../src/lib/server/recovery.ts#L21) | [lib/server/payments.ts:191](../src/lib/server/payments.ts#L191) |
|  `` review ``  ·  `` card_failed ``  | See handler |  `` `Your card was declined, so ${name} wasn't paid ${money(cents)} for the ${label === "live call" ? "call" : label} yet. Your tests are paused until you pay what you owe: open Payments.` ``  · [lib/rules.ts:1406](../src/lib/rules.ts#L1406) | [lib/server/payments.ts:208](../src/lib/server/payments.ts#L208) |
|  `` refuseSuspendedLocked ``  ·  `` suspended ``  |  `` u?.devSuspendedAt ``  |  `` `Your account is suspended: ${what} waits until it is lifted.` ``  · [lib/server/payments.ts:242](../src/lib/server/payments.ts#L242) | [lib/server/payments.ts:249](../src/lib/server/payments.ts#L249) |
|  `` suspendedAfterCheck ``  ·  `` admin_paused ``  |  `` teamPaused ``  |  `` `The team paused this test: ${what} waits until the pause is lifted.` ``  · [lib/restricted.ts:67](../src/lib/restricted.ts#L67) | [lib/server/payments.ts:264](../src/lib/server/payments.ts#L264) |
|  `` suspendedAfterCheck ``  ·  `` suspended ``  | See handler |  `` `Your account is suspended: ${what} waits until it is lifted.` ``  · [lib/server/payments.ts:242](../src/lib/server/payments.ts#L242) | [lib/server/payments.ts:265](../src/lib/server/payments.ts#L265) |
|  `` reserving ``  ·  `` payments_problem ``  |  `` isTxTimeout(e) ``  |  `` Payments are having a problem right now. Nothing was charged; try again shortly. ``  · [lib/server/stripe.ts:297](../src/lib/server/stripe.ts#L297) | [lib/server/payments.ts:278](../src/lib/server/payments.ts#L278) |
|  `` openDispute ``  ·  `` bad_reason ``  |  `` reason.length < 10 ``  |  `` Say why you think the pay should be higher (at least a sentence). ``  | [lib/server/payments.ts:335](../src/lib/server/payments.ts#L335) |
|  `` openDispute ``  ·  `` not_found ``  |  `` !c &#124;&#124; c.testerId !== tester.id ``  |  `` That session doesn't exist or isn't yours. ``  | [lib/server/payments.ts:337](../src/lib/server/payments.ts#L337) |
|  `` openDispute ``  ·  `` no_dispute ``  |  `` shut && !(await db.dispute.findFirst({ where })) ``  |  `` shut ``  · [lib/server/payments.ts:341](../src/lib/server/payments.ts#L341) | [lib/server/payments.ts:342](../src/lib/server/payments.ts#L342) |
|  `` openDispute ``  ·  `` no_dispute ``  |  `` review?.teamClosedById ``  |  `` The team closed this for $0, so it can't be disputed. ``  · [lib/moneyLines.ts:49](../src/lib/moneyLines.ts#L49) | [lib/server/payments.ts:348](../src/lib/server/payments.ts#L348) |
|  `` openDispute ``  ·  `` not_paid ``  |  `` !review ``  |  `` This hasn't been paid yet. ``  | [lib/server/payments.ts:349](../src/lib/server/payments.ts#L349) |
|  `` openDispute → disputable ``  ·  `` no_dispute ``  |  `` !ok.ok → recent && bounds ``  |  `` `${dev} paid ${money(cents)}${more ? " more" : ""} meanwhile (${time}): this part is now paid the most it can be (${money(maxCents)}), so there's nothing to dispute.` ``  · [lib/server/payments.ts:400](../src/lib/server/payments.ts#L400) | [lib/server/payments.ts:362](../src/lib/server/payments.ts#L362) |
|  `` openDispute → disputable ``  ·  `` no_dispute ``  |  `` !ok.ok ``  |  `` ok.message ``  · [lib/rules.ts:73](../src/lib/rules.ts#L73) | [lib/server/payments.ts:363](../src/lib/server/payments.ts#L363) |
|  `` openDispute ``  ·  `` no_dispute ``  |  `` await tx.dispute.findFirst({ where }) ``  |  `` You already disputed this payment. A part can be disputed once. ``  · [lib/rules.ts:136](../src/lib/rules.ts#L136) | [lib/server/payments.ts:381](../src/lib/server/payments.ts#L381) |
|  `` openDispute ``  ·  `` no_dispute ``  |  `` isUniqueClash(e) ``  |  `` You already disputed this payment. A part can be disputed once. ``  · [lib/rules.ts:136](../src/lib/rules.ts#L136) | [lib/server/payments.ts:384](../src/lib/server/payments.ts#L384) |
|  `` decideDispute ``  ·  `` not_admin ``  |  `` !isAdmin(admin) ``  |  `` Only admins can decide disputes. ``  | [lib/server/payments.ts:450](../src/lib/server/payments.ts#L450) |
|  `` decideDispute ``  ·  `` not_found ``  |  `` !d ``  |  `` That dispute doesn't exist. ``  | [lib/server/payments.ts:452](../src/lib/server/payments.ts#L452) |
|  `` decideDispute ``  ·  `` decided ``  |  `` d.status !== "open" ``  |  `` `You already ${what}${where === "other" ? " in another tab" : ""} at ${whenText(at)}.` ``  · [lib/server/adminRace.ts:95](../src/lib/server/adminRace.ts#L95)<br> `` `${who} already decided this dispute${at ? ` at ${fmtTime(at)}` : ""}.` ``  · [lib/server/payments.ts:583](../src/lib/server/payments.ts#L583) | [lib/server/payments.ts:454](../src/lib/server/payments.ts#L454) |
|  `` decideDispute ``  ·  `` locked ``  |  `` await (await import("./confirm")).pieceLocked({ submissionId: d.submissionId, callId: d.callId }) ``  |  `` `The developer is confirming a payment for this piece with ${pronouns(pronoun).poss} bank. Decide again once it's confirmed or fails.` ``  · [lib/server/payments.ts:444](../src/lib/server/payments.ts#L444) | [lib/server/payments.ts:463](../src/lib/server/payments.ts#L463) |
|  `` decideDispute ``  ·  `` bad_amount ``  |  `` !check.ok ``  |  `` check.message ``  · [lib/rules.ts:73](../src/lib/rules.ts#L73) | [lib/server/payments.ts:485](../src/lib/server/payments.ts#L485) |
|  `` decideDispute ``  ·  `` needs_tick ``  |  `` extra > 0 && !tickOk ``  |  `` `Tick “${decideTickLabel(devName, extraCents, totalCents)}” to decide.` ``  · [lib/rules.ts:58](../src/lib/rules.ts#L58) | [lib/server/payments.ts:493](../src/lib/server/payments.ts#L493) |
|  `` decideDispute ``  ·  `` locked ``  |  `` await tx.payment.count({ where: { ...key, status: { in: ["pending", "needs_action", "needs_confirmation"] } } }) ``  |  `` `The developer is confirming a payment for this piece with ${pronouns(pronoun).poss} bank. Decide again once it's confirmed or fails.` ``  · [lib/server/payments.ts:444](../src/lib/server/payments.ts#L444) | [lib/server/payments.ts:502](../src/lib/server/payments.ts#L502) |
|  `` decideDispute ``  ·  `` decided ``  |  `` !claim ``  |  `` `You already ${what}${where === "other" ? " in another tab" : ""} at ${whenText(at)}.` ``  · [lib/server/adminRace.ts:95](../src/lib/server/adminRace.ts#L95)<br> `` `${who} already decided this dispute${at ? ` at ${fmtTime(at)}` : ""}.` ``  · [lib/server/payments.ts:583](../src/lib/server/payments.ts#L583) | [lib/server/payments.ts:520](../src/lib/server/payments.ts#L520) |
|  `` decideDispute ``  ·  `` no_card ``  |  `` else waiting → due > 0 → !(e instanceof HttpError && e.code === "card_failed") → e instanceof HttpError && e.code === "no_card" ``  |  `` `The developer's saved card is no longer available, so nothing was charged and the dispute stays open. Decide again once ${pronouns(c.test.developer.pronoun).subj} ${pronouns(c.test.developer.pronoun).v("adds", "add")} a card.` ``  | [lib/server/payments.ts:550](../src/lib/server/payments.ts#L550) |
|  `` addDevSide ``  ·  `` not_found ``  |  `` !d &#124;&#124; !c &#124;&#124; c.testId !== testId &#124;&#124; c.test.developerId !== dev.id ``  |  `` That dispute doesn't exist. ``  | [lib/server/payments.ts:601](../src/lib/server/payments.ts#L601) |
|  `` addDevSide ``  ·  `` decided ``  |  `` d.status !== "open" ``  |  `` This dispute was already decided. ``  | [lib/server/payments.ts:602](../src/lib/server/payments.ts#L602) |
|  `` addDevSide ``  ·  `` dev_side ``  |  `` !ok.ok ``  |  `` ok.message ``  · [lib/rules.ts:73](../src/lib/rules.ts#L73) | [lib/server/payments.ts:606](../src/lib/server/payments.ts#L606) |
|  `` addDevSide ``  ·  `` now.devSideAt ? "dev_side" : "decided" ``  |  `` claimed.count !== 1 ``  |  `` You already added your side. ``  · [lib/rules.ts:1469](../src/lib/rules.ts#L1469)<br> `` This dispute was already decided. ``  · [lib/server/payments.ts:615](../src/lib/server/payments.ts#L615) | [lib/server/payments.ts:615](../src/lib/server/payments.ts#L615) |
|  `` payExtra ``  ·  `` not_found ``  |  `` !c &#124;&#124; c.testId !== testId &#124;&#124; c.test.developerId !== dev.id ``  |  `` Choose a tester. ``  | [lib/server/payments.ts:699](../src/lib/server/payments.ts#L699) |
|  `` payExtra ``  ·  `` not_found ``  |  `` !piece &#124;&#124; piece.contractId !== c.id ``  |  `` Choose a part they sent. ``  | [lib/server/payments.ts:702](../src/lib/server/payments.ts#L702) |
|  `` payExtra ``  ·  `` not_held ``  |  `` piece.kind === "call" && ("status" in piece && (piece.status === "cancelled" &#124;&#124; (piece.startsAt && piece.startsAt > new Date()))) ``  |  `` Extra pay goes on a call that took place. ``  | [lib/server/payments.ts:703](../src/lib/server/payments.ts#L703) |
|  `` payExtra ``  ·  `` not_paid ``  |  `` !paidReview &#124;&#124; paidReview.rejected ``  |  `` Pay this part first: Pay more is for a part you've already paid. ``  | [lib/server/payments.ts:706](../src/lib/server/payments.ts#L706) |
|  `` payExtra ``  ·  `` team_closed ``  |  `` paidReview.teamClosedById ``  |  `` The team closed this for $0. ``  · [lib/moneyLines.ts:51](../src/lib/moneyLines.ts#L51) | [lib/server/payments.ts:708](../src/lib/server/payments.ts#L708) |
|  `` payExtra ``  ·  `` closed ``  |  `` paidReview.reason === UNLISTED_CALL_CLOSED ``  |  `` `${call} closed with nothing paid: it wasn't listed and wasn't paid within ${REVIEW_DAYS} days.` ``  · [lib/rules.ts:1522](../src/lib/rules.ts#L1522) | [lib/server/payments.ts:710](../src/lib/server/payments.ts#L710) |
|  `` payExtra ``  ·  `` pay_more_closed ``  |  `` closedOut(at) ``  |  `` `${more ? "Pay more" : "Pay"} closed on ${date}.` ``  · [lib/rules.ts:1930](../src/lib/rules.ts#L1930) | [lib/server/payments.ts:714](../src/lib/server/payments.ts#L714) |
|  `` payExtra ``  ·  `` suspended ``  |  `` devNow.devSuspendedAt ``  |  `` Your account is suspended: extra pay waits until it is lifted. ``  | [lib/server/payments.ts:718](../src/lib/server/payments.ts#L718) |
|  `` payExtra ``  ·  `` unavailable ``  |  `` (await blockedEitherWay(dev.id, c.testerId)) &#124;&#124; !testerPayable(c.tester) ``  |  `` This payment isn't available. ``  | [lib/server/payments.ts:722](../src/lib/server/payments.ts#L722) |
|  `` payExtra ``  ·  `` bad_amount ``  |  `` !check.ok ``  |  `` check.message ``  · [lib/rules.ts:73](../src/lib/rules.ts#L73) | [lib/server/payments.ts:728](../src/lib/server/payments.ts#L728) |
|  `` payExtra ``  ·  `` no_card ``  |  `` card ``  |  ``  ``  · [lib/server/stripe.ts:150](../src/lib/server/stripe.ts#L150)<br> `` Add a card in Payments first, then press Pay again. ``  · [lib/server/stripe.ts:145](../src/lib/server/stripe.ts#L145) | [lib/server/payments.ts:730](../src/lib/server/payments.ts#L730) |
|  `` payExtra ``  ·  `` bank_waits ``  |  `` waits ``  |  `` waits ``  · [lib/server/payments.ts:743](../src/lib/server/payments.ts#L743) | [lib/server/payments.ts:744](../src/lib/server/payments.ts#L744) |
|  `` payExtra ``  ·  `` over_cap ``  |  `` amount! > room.roomCents ``  |  `` `This is more than you can pay for this call (up to ${money(roomCents)}: what's left of the ${dollars(CALLS_TOTAL_CENTS)} for calls on this test).` ``  · [lib/callMeasure.ts:109](../src/lib/callMeasure.ts#L109)<br> `` `This is more than you can pay for this call (up to ${money(roomCents)} at ${money(NO_LISTING_CALL_RATE_CAP_CENTS).replace(/\.00$/, "")} an hour).` ``  · [lib/rules.ts:1953](../src/lib/rules.ts#L1953)<br> `` `Paid the most this piece can be paid (${money(cents)}).` ``  · [lib/rules.ts:1963](../src/lib/rules.ts#L1963)<br> `` `This is more than this piece can be paid (up to ${money(roomCents).replace(/\.00$/, "")}${roomCents < totalCents ? ` more, ${money(totalCents).replace(/\.00$/, "")} in all` : ""}).` ``  · [lib/rules.ts:1972](../src/lib/rules.ts#L1972) | [lib/server/payments.ts:754](../src/lib/server/payments.ts#L754) |
|  `` payExtra ``  ·  `` payment_unknown ``  |  `` e instanceof HttpError && e.code === "payment_unknown" ``  |  `` We didn't hear back from the payment service, so this payment is being checked. Within 15 minutes it shows as paid, or it's back here to pay again. Don't pay it twice: it's never charged twice. ``  · [lib/server/recovery.ts:21](../src/lib/server/recovery.ts#L21) | [lib/server/payments.ts:780](../src/lib/server/payments.ts#L780) |
|  `` payExtra ``  ·  `` card_failed ``  | See handler |  `` `Your card was declined, so ${name} wasn't paid ${money(amount)} extra yet. Your tests are paused until you pay what you owe: open Payments.` ``  | [lib/server/payments.ts:789](../src/lib/server/payments.ts#L789) |
|  `` closeUpdateAtZero ``  ·  `` bad_amount ``  |  `` !s &#124;&#124; !updateWaiting(s) ``  |  `` Enter an amount like 7.50. ``  | [lib/server/payments.ts:812](../src/lib/server/payments.ts#L812) |

### `src/lib/server/ratings.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` readRating ``  ·  `` bad_stars ``  |  `` !Number.isInteger(stars) &#124;&#124; stars < 1 &#124;&#124; stars > 5 ``  |  `` Choose 1 to 5 stars. ``  | [lib/server/ratings.ts:216](../src/lib/server/ratings.ts#L216) |
|  `` readRating ``  ·  `` bad_comment ``  |  `` comment.length > 500 ``  |  `` Keep the comment to 500 characters or fewer. ``  | [lib/server/ratings.ts:218](../src/lib/server/ratings.ts#L218) |
|  `` ratedOnce ``  ·  `` rated ``  |  `` isUniqueClash(e) ``  |  `` already ``  · [lib/server/ratings.ts:251](../src/lib/server/ratings.ts#L251) | [lib/server/ratings.ts:252](../src/lib/server/ratings.ts#L252) |
|  `` refuse ``  ·  `` rated ``  |  `` s.kind === "rated" ``  |  `` already ``  · [lib/server/ratings.ts:255](../src/lib/server/ratings.ts#L255) | [lib/server/ratings.ts:256](../src/lib/server/ratings.ts#L256) |
|  `` refuse ``  ·  `` s.line === RATE_INACTIVE &#124;&#124; s.line === RATE_TEAM_PAUSED ? "inactive" : "not_yet" ``  | See handler |  `` s.line ``  · [lib/server/ratings.ts:45](../src/lib/server/ratings.ts#L45) | [lib/server/ratings.ts:257](../src/lib/server/ratings.ts#L257) |
|  `` assertRatingAccounts ``  ·  `` deleted ``  |  `` await tx.user.count({where:{id:{in:[first,second]},deletedAt:{not:null}}}) ``  |  `` Rating is unavailable because an account was deleted. ``  | [lib/server/ratings.ts:262](../src/lib/server/ratings.ts#L262) |
|  `` devRate ``  ·  `` not_found ``  |  `` !c0 &#124;&#124; c0.testId !== testId ``  |  `` Choose a tester. ``  | [lib/server/ratings.ts:302](../src/lib/server/ratings.ts#L302) |

### `src/lib/server/recordings.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` startRecording ``  ·  `` closed ``  |  `` refusal ``  |  ``  ``  · [lib/rules.ts:232](../src/lib/rules.ts#L232) | [lib/server/recordings.ts:26](../src/lib/server/recordings.ts#L26) |
|  `` startRecording ``  ·  `` bad_type ``  |  `` !video && (part !== "written" &#124;&#124; isVideo(type) &#124;&#124; !ATTACHMENT_TYPES.includes(type)) ``  |  `` Attach an image (PNG, JPEG, GIF or WebP), a PDF, a text file (.txt), a zip, or a video in MP4, WebM, MOV or M4V format. ``  · [lib/videoFormats.ts:13](../src/lib/videoFormats.ts#L13)<br> `` Choose a video in MP4, WebM, MOV or M4V format (.mp4, .webm, .mov or .m4v). ``  · [lib/videoFormats.ts:12](../src/lib/videoFormats.ts#L12) | [lib/server/recordings.ts:36](../src/lib/server/recordings.ts#L36) |
|  `` startRecording ``  ·  `` empty ``  |  `` !Number.isFinite(size) &#124;&#124; size <= 0 ``  |  `` That file is empty. ``  | [lib/server/recordings.ts:37](../src/lib/server/recordings.ts#L37) |
|  `` startRecording ``  ·  `` too_large ``  |  `` video && size > MAX_RECORDING_BYTES ``  |  `` Recordings can be at most 500 MB. ``  | [lib/server/recordings.ts:38](../src/lib/server/recordings.ts#L38) |
|  `` startRecording ``  ·  `` too_large ``  |  `` !video && size > MAX_ATTACHMENT_BYTES ``  |  `` Files can be at most 500 MB. ``  | [lib/server/recordings.ts:39](../src/lib/server/recordings.ts#L39) |
|  `` startRecording ``  ·  `` paid ``  |  `` locked ``  |  ``  ``  · [lib/server/paidUpdates.ts:14](../src/lib/server/paidUpdates.ts#L14)<br> `` The team closed this for $0, so it can't be changed. ``  · [lib/moneyLines.ts:50](../src/lib/moneyLines.ts#L50)<br> `` Your written answers were already reviewed, so they can't be changed. ``  · [lib/server/paidUpdates.ts:13](../src/lib/server/paidUpdates.ts#L13)<br> `` Your recording was already reviewed, so it can't be changed. ``  · [lib/server/paidUpdates.ts:13](../src/lib/server/paidUpdates.ts#L13) | [lib/server/recordings.ts:43](../src/lib/server/recordings.ts#L43) |
|  `` startRecording ``  ·  `` too_many ``  |  `` video && part === "recording" && mine.filter((r) => r.part === "recording").length >= MAX_RECORDINGS ``  |  `` `You can add at most ${MAX_RECORDINGS} recordings. Remove one first.` ``  · [lib/server/recordings.ts:120](../src/lib/server/recordings.ts#L120)<br> `` `You've sent ${MAX_RECORDINGS} recordings, the most this part takes.` ``  · [lib/server/recordings.ts:122](../src/lib/server/recordings.ts#L122) | [lib/server/recordings.ts:48](../src/lib/server/recordings.ts#L48) |
|  `` startRecording ``  ·  `` too_many ``  |  `` video && part === "written" && mine.filter((r) => r.part === "written" && isVideo(r.contentType)).length >= MAX_RECORDINGS ``  |  `` `You can attach at most ${MAX_RECORDINGS} recordings to your written answers.` ``  | [lib/server/recordings.ts:49](../src/lib/server/recordings.ts#L49) |
|  `` startRecording ``  ·  `` quota ``  |  `` today + size > DAILY_UPLOAD_BYTES ``  |  `` You've uploaded a lot today. Try again tomorrow. ``  · [lib/server/recordings.ts:97](../src/lib/server/recordings.ts#L97) | [lib/server/recordings.ts:52](../src/lib/server/recordings.ts#L52) |
|  `` startRecording ``  ·  `` too_many ``  |  `` !video && mine.filter((r) => r.part === "written" && !isVideo(r.contentType)).length >= MAX_ATTACHMENTS ``  |  `` `You can attach at most ${MAX_ATTACHMENTS} files to your written answers.` ``  | [lib/server/recordings.ts:53](../src/lib/server/recordings.ts#L53) |
|  `` finishRecording ``  ·  `` not_found ``  |  `` !rec &#124;&#124; rec.contractId !== contractId ``  |  `` That upload doesn't exist. ``  | [lib/server/recordings.ts:66](../src/lib/server/recordings.ts#L66) |
|  `` finishRecording ``  ·  `` upload_unfinished ``  |  `` r2On() → !head &#124;&#124; head.size !== rec.sizeBytes &#124;&#124; head.size > limit ``  |  `` That upload didn't finish properly. Try again. ``  · [lib/server/recordings.ts:119](../src/lib/server/recordings.ts#L119) | [lib/server/recordings.ts:75](../src/lib/server/recordings.ts#L75) |
|  `` removeRecording ``  ·  `` not_found ``  |  `` body.written === true → !rec &#124;&#124; rec.contractId !== contractId &#124;&#124; rec.part !== "written" ``  |  `` That file was already removed. ``  | [lib/server/recordings.ts:146](../src/lib/server/recordings.ts#L146) |
|  `` removeRecording ``  ·  `` not_found ``  |  `` !rec &#124;&#124; rec.contractId !== contractId &#124;&#124; rec.part !== "recording" ``  |  `` That recording was already removed. ``  | [lib/server/recordings.ts:157](../src/lib/server/recordings.ts#L157) |
|  `` removeRecording ``  ·  `` locked ``  |  `` rec.submissionId ``  |  `` Recordings you sent can't be removed. You can add more. ``  · [lib/rules.ts:1335](../src/lib/rules.ts#L1335) | [lib/server/recordings.ts:159](../src/lib/server/recordings.ts#L159) |
|  `` sendRecording ``  ·  `` closed ``  |  `` ended ``  |  ``  ``  · [lib/rules.ts:232](../src/lib/rules.ts#L232) | [lib/server/recordings.ts:169](../src/lib/server/recordings.ts#L169) |
|  `` sendRecording ``  ·  `` paused ``  |  `` !sessionRefusal(c0, c0.test, displayName(c0.test.developer)) && testerPaused(c0.test.developer, c0.test) ``  |  `` `${PAUSED_RIGHT_NOW} You can send this once it resumes.` ``  · [lib/rules.ts:923](../src/lib/rules.ts#L923) | [lib/server/recordings.ts:171](../src/lib/server/recordings.ts#L171) |
|  `` sendRecording ``  ·  `` paid ``  |  `` shut ``  |  ``  ``  · [lib/server/paidUpdates.ts:14](../src/lib/server/paidUpdates.ts#L14)<br> `` The team closed this for $0, so it can't be changed. ``  · [lib/moneyLines.ts:50](../src/lib/moneyLines.ts#L50)<br> `` Your written answers were already reviewed, so they can't be changed. ``  · [lib/server/paidUpdates.ts:13](../src/lib/server/paidUpdates.ts#L13)<br> `` Your recording was already reviewed, so it can't be changed. ``  · [lib/server/paidUpdates.ts:13](../src/lib/server/paidUpdates.ts#L13) | [lib/server/recordings.ts:178](../src/lib/server/recordings.ts#L178) |
|  `` sendRecording ``  ·  `` none ``  |  `` sent && !(await db.recording.count({ where: { contractId, part: "recording", submissionId: null, OR: [{ uploadedAt: { not: null } }, stillUploading("recording")] } })) ``  |  `` Upload or record a recording to add first. ``  · [lib/rules.ts:1337](../src/lib/rules.ts#L1337) | [lib/server/recordings.ts:179](../src/lib/server/recordings.ts#L179) |
|  `` sendRecording ``  ·  `` closed ``  |  `` refusal ``  |  ``  ``  · [lib/rules.ts:232](../src/lib/rules.ts#L232) | [lib/server/recordings.ts:189](../src/lib/server/recordings.ts#L189) |
|  `` sendRecording ``  ·  `` uploading ``  |  `` await tx.recording.count({ where: { contractId, ...stillUploading("recording") } }) ``  |  `` A recording is still uploading. Send once it's done. ``  · [lib/server/recordings.ts:123](../src/lib/server/recordings.ts#L123) | [lib/server/recordings.ts:191](../src/lib/server/recordings.ts#L191) |
|  `` sendRecording ``  ·  `` paid ``  |  `` locked ``  |  ``  ``  · [lib/server/paidUpdates.ts:14](../src/lib/server/paidUpdates.ts#L14)<br> `` The team closed this for $0, so it can't be changed. ``  · [lib/moneyLines.ts:50](../src/lib/moneyLines.ts#L50)<br> `` Your written answers were already reviewed, so they can't be changed. ``  · [lib/server/paidUpdates.ts:13](../src/lib/server/paidUpdates.ts#L13)<br> `` Your recording was already reviewed, so it can't be changed. ``  · [lib/server/paidUpdates.ts:13](../src/lib/server/paidUpdates.ts#L13) | [lib/server/recordings.ts:194](../src/lib/server/recordings.ts#L194) |
|  `` sendRecording ``  ·  `` none ``  |  `` !fresh.length ``  |  `` Upload or record a recording to add first. ``  · [lib/rules.ts:1337](../src/lib/rules.ts#L1337)<br> `` Upload a recording first. ``  · [lib/server/recordings.ts:198](../src/lib/server/recordings.ts#L198) | [lib/server/recordings.ts:198](../src/lib/server/recordings.ts#L198) |

### `src/lib/server/reports.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` reportPerson ``  ·  `` bad_user ``  |  `` !otherId &#124;&#124; otherId === me.id ``  |  `` Choose someone to report. ``  | [lib/server/reports.ts:14](../src/lib/server/reports.ts#L14) |
|  `` reportPerson ``  ·  `` not_found ``  |  `` !other &#124;&#124; other.deletedAt ``  |  `` That person doesn't exist. ``  | [lib/server/reports.ts:16](../src/lib/server/reports.ts#L16) |
|  `` reportPerson ``  ·  `` already ``  |  `` had ``  |  `` `You already reported ${displayName(other)} on ${fmtDate(had.createdAt)}.` ``  | [lib/server/reports.ts:19](../src/lib/server/reports.ts#L19) |
|  `` reportPerson ``  ·  `` bad_note ``  |  `` note.length < REPORT_NOTE_MIN ``  |  `` Say what happened (the team reads it). ``  | [lib/server/reports.ts:20](../src/lib/server/reports.ts#L20) |
|  `` reportPerson ``  ·  `` already ``  |  `` !r ``  |  `` `You already reported ${displayName(other)}.` ``  | [lib/server/reports.ts:25](../src/lib/server/reports.ts#L25) |

### `src/lib/server/requests.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` ctx ``  ·  `` not_found ``  |  `` !c &#124;&#124; !side ``  |  `` That session doesn't exist. ``  | [lib/server/requests.ts:68](../src/lib/server/requests.ts#L68) |
|  `` readMinutes ``  ·  `` bad_minutes ``  |  `` body.minutes === "" ``  |  `` Enter the call's length in minutes. ``  | [lib/server/requests.ts:112](../src/lib/server/requests.ts#L112) |
|  `` readMinutes ``  ·  `` bad_minutes ``  |  `` !r.ok ``  |  `` r.message ``  · [lib/rules.ts:1383](../src/lib/rules.ts#L1383) | [lib/server/requests.ts:114](../src/lib/server/requests.ts#L114) |
|  `` readRows ``  ·  `` bad_time ``  |  `` windowShut(end, CALL_MIN_AHEAD_MINUTES) ``  |  `` `No more calls can be requested: testers' work on this test ends ${endText}, less than ${leadWords(minutes)} from now.` ``  · [lib/callWindow.ts:57](../src/lib/callWindow.ts#L57) | [lib/server/requests.ts:127](../src/lib/server/requests.ts#L127) |
|  `` readRows → future ``  ·  `` bad_time ``  |  `` isNaN(d.getTime()) &#124;&#124; !farEnoughAhead(d) ``  |  `` `Pick a time at least ${leadWords(minutes)} from now.` ``  · [lib/callWindow.ts:26](../src/lib/callWindow.ts#L26)<br> `` Pick a time in the future. ``  · [lib/callWindow.ts:26](../src/lib/callWindow.ts#L26) | [lib/server/requests.ts:130](../src/lib/server/requests.ts#L130) |
|  `` readRows → future ``  ·  `` bad_time ``  |  `` end && d.getTime() > end.getTime() ``  |  `` `Pick a time before ${endText} (when testers' work on this test ends).` ``  · [lib/callWindow.ts:29](../src/lib/callWindow.ts#L29) | [lib/server/requests.ts:131](../src/lib/server/requests.ts#L131) |
|  `` readRows ``  ·  `` bad_weeks ``  |  `` Array.isArray(body.rows) → !forever && (!Number.isInteger(n) &#124;&#124; n < 2 &#124;&#124; n > (end ? 366 : 8)) ``  |  `` `${repeat === "daily" ? "Daily" : "Weekly"} calls repeat at least 2 times.` ``  · [lib/server/requests.ts:144](../src/lib/server/requests.ts#L144)<br> `` `${repeat === "daily" ? "Daily" : "Weekly"} calls repeat 2 to 8 times.` ``  · [lib/server/requests.ts:144](../src/lib/server/requests.ts#L144) | [lib/server/requests.ts:144](../src/lib/server/requests.ts#L144) |
|  `` readRows ``  ·  `` bad_time ``  |  `` else Array.isArray(body.rows) → !times.length ``  |  `` `Pick a time at least ${leadWords(minutes)} from now.` ``  · [lib/callWindow.ts:26](../src/lib/callWindow.ts#L26)<br> `` Pick a time in the future. ``  · [lib/callWindow.ts:26](../src/lib/callWindow.ts#L26) | [lib/server/requests.ts:152](../src/lib/server/requests.ts#L152) |
|  `` readRows ``  ·  `` bad_kind ``  |  `` else Array.isArray(body.rows) → weeks → times.length !== 1 ``  |  `` `A ${repeat} request has exactly one time.` ``  | [lib/server/requests.ts:155](../src/lib/server/requests.ts#L155) |
|  `` readRows ``  ·  `` bad_weeks ``  |  `` else Array.isArray(body.rows) → weeks → weeks < 2 &#124;&#124; weeks > 8 ``  |  `` `${repeat === "daily" ? "Daily" : "Weekly"} calls repeat 2 to 8 times.` ``  | [lib/server/requests.ts:156](../src/lib/server/requests.ts#L156) |
|  `` readRows ``  ·  `` bad_time ``  |  `` !rows.length ``  |  `` `Pick a time at least ${leadWords(minutes)} from now.` ``  · [lib/callWindow.ts:26](../src/lib/callWindow.ts#L26)<br> `` Pick a time in the future. ``  · [lib/callWindow.ts:26](../src/lib/callWindow.ts#L26) | [lib/server/requests.ts:160](../src/lib/server/requests.ts#L160) |
|  `` readRows ``  ·  `` bad_kind ``  |  `` rows.length > MAX_ROWS ``  |  `` Send up to 3 times at once. ``  | [lib/server/requests.ts:161](../src/lib/server/requests.ts#L161) |
|  `` sendClash ``  ·  `` their_request ``  |  `` mine && r.fromSide !== mine.side ``  |  `` `${otherName} already asked for ${fmtDateTime(hit)} (${r.minutes} min). Accept ${mine.otherPoss} request, or pick a time that doesn't overlap.` ``  | [lib/server/requests.ts:200](../src/lib/server/requests.ts#L200) |
|  `` createRequests ``  ·  `` closed ``  |  `` c.status !== "working" ``  |  `` This session has ended. ``  | [lib/server/requests.ts:324](../src/lib/server/requests.ts#L324) |
|  `` createRequests ``  ·  `` limit ``  |  `` line ``  |  ``  ``  · [lib/server/requests.ts:308](../src/lib/server/requests.ts#L308) | [lib/server/requests.ts:328](../src/lib/server/requests.ts#L328) |
|  `` bookAt ``  ·  `` closed ``  |  `` fresh.status !== "working" ``  |  `` This session has ended. ``  | [lib/server/requests.ts:352](../src/lib/server/requests.ts#L352) |
|  `` claimRequest ``  ·  `` gone ``  | See handler |  `` `${r.closedReason}.` ``  · [lib/server/requests.ts:472](../src/lib/server/requests.ts#L472)<br> `` `This request closed: ${dropReasonFor(r.closedReason, (mine ? r.fromSide : r.fromSide === "developer" ? "tester" : "developer") as Side, otherName)}.` ``  · [lib/server/requests.ts:475](../src/lib/server/requests.ts#L475)<br> `` You already withdrew this request. ``  · [lib/server/requests.ts:477](../src/lib/server/requests.ts#L477)<br> `` `${otherName} withdrew this request.` ``  · [lib/server/requests.ts:477](../src/lib/server/requests.ts#L477)<br> `` `${otherName} declined this request at ${fmtTime(r.updatedAt)}.` ``  · [lib/server/requests.ts:478](../src/lib/server/requests.ts#L478)<br> `` You already declined this request. ``  · [lib/server/requests.ts:478](../src/lib/server/requests.ts#L478)<br> `` `This time was booked at ${fmtTime(r.updatedAt)}.` ``  · [lib/server/requests.ts:480](../src/lib/server/requests.ts#L480)<br> `` `You already accepted this request at ${fmtTime(r.updatedAt)}.` ``  · [lib/server/requests.ts:480](../src/lib/server/requests.ts#L480)<br> `` `The call time ${fmtDateTime(r.startsAt)} is no longer available.` ``  · [lib/server/requests.ts:481](../src/lib/server/requests.ts#L481)<br> `` `This request closed${r.closedReason ? `: ${r.closedReason}` : ""}.` ``  · [lib/server/requests.ts:482](../src/lib/server/requests.ts#L482) | [lib/server/requests.ts:488](../src/lib/server/requests.ts#L488) |
|  `` pausedRefusal ``  ·  `` paused ``  |  `` testPaused(c.test.developer, c.test) ``  |  `` `${PAUSED_RIGHT_NOW} You can request calls once it resumes.` ``  · [lib/server/requests.ts:493](../src/lib/server/requests.ts#L493)<br> `` Your account is suspended: your tests are paused. Contact us in Settings to appeal. ``  · [lib/server/users.ts:19](../src/lib/server/users.ts#L19)<br> `` Pay what you owe first. ``  · [lib/server/requests.ts:493](../src/lib/server/requests.ts#L493)<br> `` The team paused this test. ``  · [lib/server/requests.ts:493](../src/lib/server/requests.ts#L493) | [lib/server/requests.ts:493](../src/lib/server/requests.ts#L493) |
|  `` refusals ``  ·  `` closed ``  |  `` c.status !== "working" ``  |  `` Your session has ended. ``  · [lib/server/requests.ts:496](../src/lib/server/requests.ts#L496)<br> `` `${displayName(c.tester)}'s session has ended.` ``  · [lib/server/requests.ts:496](../src/lib/server/requests.ts#L496) | [lib/server/requests.ts:496](../src/lib/server/requests.ts#L496) |
|  `` refusals ``  ·  `` closed ``  |  `` c.test.status === "stopped" ``  |  `` This test was stopped. ``  | [lib/server/requests.ts:499](../src/lib/server/requests.ts#L499) |
|  `` refusals ``  ·  `` gone ``  |  `` await db.block.count({ where: { OR: [{ blockerId: c.testerId, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: c.testerId }] } }) ``  |  `` This time isn't available. ``  | [lib/server/requests.ts:502](../src/lib/server/requests.ts#L502) |
|  `` devRequestTime ``  ·  `` none ``  |  `` !ids.length ``  |  `` Tick at least one tester. ``  | [lib/server/requests.ts:573](../src/lib/server/requests.ts#L573) |
|  `` devRequestTime ``  ·  `` not_found ``  |  `` x.side !== "developer" &#124;&#124; x.c.testId !== testId ``  |  `` That tester isn't in this test. ``  | [lib/server/requests.ts:584](../src/lib/server/requests.ts#L584) |
|  `` devRequestTime ``  ·  `` limit ``  |  `` first.refused.size === all.length ``  |  `` limitText([...first.refused.values()], ["day", "total"]) ``  · [lib/server/requests.ts:557](../src/lib/server/requests.ts#L557) | [lib/server/requests.ts:636](../src/lib/server/requests.ts#L636) |
|  `` devRequestTime ``  ·  `` already ``  |  `` again.length ``  |  `` `You already requested this time with ${andList(names)}.` ``  · [lib/server/requests.ts:549](../src/lib/server/requests.ts#L549) | [lib/server/requests.ts:645](../src/lib/server/requests.ts#L645) |
|  `` devRequestTime ``  ·  `` clash ``  |  `` clash.length ``  |  `` clash[0] ``  | [lib/server/requests.ts:650](../src/lib/server/requests.ts#L650) |
|  `` devRequestTime ``  ·  `` clash ``  |  `` own ``  |  `` own ``  · [lib/server/requests.ts:654](../src/lib/server/requests.ts#L654) | [lib/server/requests.ts:655](../src/lib/server/requests.ts#L655) |
|  `` devRequestTime ``  ·  `` clash ``  |  `` all.length === 1 && blocked.length ``  |  `` blocked[0] ``  | [lib/server/requests.ts:682](../src/lib/server/requests.ts#L682) |
|  `` devRequestTime ``  ·  `` limit ``  |  `` all.length === 1 && limited.length ``  |  `` limitText(limited, ["total", "day"]) ``  · [lib/server/requests.ts:557](../src/lib/server/requests.ts#L557) | [lib/server/requests.ts:683](../src/lib/server/requests.ts#L683) |
|  `` devRequestTime ``  ·  `` limit ``  |  `` !ok.length ``  |  `` [...blocked, ...(limited.length ? [limitText(limited, ["total", "day"])] : [])].join(" ") ``  | [lib/server/requests.ts:684](../src/lib/server/requests.ts#L684) |
|  `` testerRequestTime ``  ·  `` not_found ``  |  `` side !== "tester" ``  |  `` That session doesn't exist. ``  | [lib/server/requests.ts:740](../src/lib/server/requests.ts#L740) |
|  `` testerRequestTime ``  ·  `` limit ``  |  `` line ``  |  `` line ``  · [lib/server/requests.ts:754](../src/lib/server/requests.ts#L754) | [lib/server/requests.ts:755](../src/lib/server/requests.ts#L755) |
|  `` testerRequestTime ``  ·  `` clash ``  |  `` clash.length ``  |  `` clash[0] ``  | [lib/server/requests.ts:762](../src/lib/server/requests.ts#L762) |
|  `` testerRequestTime ``  ·  `` clash ``  |  `` own ``  |  `` own ``  · [lib/server/requests.ts:764](../src/lib/server/requests.ts#L764) | [lib/server/requests.ts:765](../src/lib/server/requests.ts#L765) |
|  `` testerRequestTime ``  ·  `` clash ``  |  `` sendRows.length → clash ``  |  `` `You already have a call with ${otherName} at ${fmtDateTime(call.startsAt)}.` ``  · [lib/server/requests.ts:195](../src/lib/server/requests.ts#L195)<br> `` `You already have a request with ${otherName} waiting for that time (${fmtDateTime(t)}).` ``  · [lib/server/requests.ts:201](../src/lib/server/requests.ts#L201)<br> ``  ``  · [lib/server/requests.ts:204](../src/lib/server/requests.ts#L204) | [lib/server/requests.ts:769](../src/lib/server/requests.ts#L769) |
|  `` testerRequestTime ``  ·  `` clash ``  |  `` sendRows.length → busy ``  |  ``  ``  · [lib/server/requests.ts:543](../src/lib/server/requests.ts#L543) | [lib/server/requests.ts:772](../src/lib/server/requests.ts#L772) |
|  `` testerRequestTime ``  ·  `` limit ``  |  `` line ``  |  `` line ``  · [lib/server/requests.ts:775](../src/lib/server/requests.ts#L775) | [lib/server/requests.ts:776](../src/lib/server/requests.ts#L776) |
|  `` answerRequest ``  ·  `` not_found ``  |  `` !r &#124;&#124; r.contractId !== contractId ``  |  `` That request doesn't exist. ``  | [lib/server/requests.ts:824](../src/lib/server/requests.ts#L824) |
|  `` answerRequest ``  ·  `` pick ``  |  `` pick && isNaN(pick.getTime()) ``  |  `` Pick one of the times. ``  | [lib/server/requests.ts:837](../src/lib/server/requests.ts#L837) |
|  `` answerRequest ``  ·  `` gone ``  |  `` fresh.status === "booked" && pick && fresh.callId → call && !sameTime(call.startsAt, pick) && rowsOf(fresh).length > 1 ``  |  `` Another time of this request was booked. ``  · [lib/server/requests.ts:377](../src/lib/server/requests.ts#L377)<br> `` `You already accepted another time of this request at ${fmtTime(fresh.updatedAt)}.` ``  · [lib/server/requests.ts:840](../src/lib/server/requests.ts#L840) | [lib/server/requests.ts:840](../src/lib/server/requests.ts#L840) |
|  `` answerRequest ``  ·  `` gone ``  |  `` fresh.status !== "pending" ``  |  `` `${r.closedReason}.` ``  · [lib/server/requests.ts:472](../src/lib/server/requests.ts#L472)<br> `` `This request closed: ${dropReasonFor(r.closedReason, (mine ? r.fromSide : r.fromSide === "developer" ? "tester" : "developer") as Side, otherName)}.` ``  · [lib/server/requests.ts:475](../src/lib/server/requests.ts#L475)<br> `` You already withdrew this request. ``  · [lib/server/requests.ts:477](../src/lib/server/requests.ts#L477)<br> `` `${otherName} withdrew this request.` ``  · [lib/server/requests.ts:477](../src/lib/server/requests.ts#L477)<br> `` `${otherName} declined this request at ${fmtTime(r.updatedAt)}.` ``  · [lib/server/requests.ts:478](../src/lib/server/requests.ts#L478)<br> `` You already declined this request. ``  · [lib/server/requests.ts:478](../src/lib/server/requests.ts#L478)<br> `` `This time was booked at ${fmtTime(r.updatedAt)}.` ``  · [lib/server/requests.ts:480](../src/lib/server/requests.ts#L480)<br> `` `You already accepted this request at ${fmtTime(r.updatedAt)}.` ``  · [lib/server/requests.ts:480](../src/lib/server/requests.ts#L480)<br> `` `The call time ${fmtDateTime(r.startsAt)} is no longer available.` ``  · [lib/server/requests.ts:481](../src/lib/server/requests.ts#L481)<br> `` `This request closed${r.closedReason ? `: ${r.closedReason}` : ""}.` ``  · [lib/server/requests.ts:482](../src/lib/server/requests.ts#L482) | [lib/server/requests.ts:842](../src/lib/server/requests.ts#L842) |
|  `` answerRequest ``  ·  `` not_yours ``  |  `` action === "withdraw" ? !mine : mine ``  |  `` You can't answer your own request: withdraw it instead. ``  · [lib/server/requests.ts:843](../src/lib/server/requests.ts#L843)<br> `` Only the person who asked can withdraw it. ``  · [lib/server/requests.ts:843](../src/lib/server/requests.ts#L843) | [lib/server/requests.ts:843](../src/lib/server/requests.ts#L843) |
|  `` answerRequest ``  ·  `` limit ``  |  `` action === "accept" && (await callsTaken(contractId)) > MAX_CALLS ``  |  `` `You already have ${MAX_CALLS} calls booked or requested with ${name}. Wait until one is answered, over or cancelled, or withdraw a request.` ``  · [lib/callClash.ts:49](../src/lib/callClash.ts#L49) | [lib/server/requests.ts:846](../src/lib/server/requests.ts#L846) |
|  `` answerRequest ``  ·  `` pick ``  |  `` action === "accept" → else rowsR.length === 1 && (!pick &#124;&#124; sameTime(rowsR[0].startsAt, pick)) → !chosen ``  |  `` Pick one of the times. ``  | [lib/server/requests.ts:870](../src/lib/server/requests.ts#L870) |
|  `` answerRequest ``  ·  `` too_soon ``  |  `` action === "accept" → !farEnoughAhead(row.startsAt) ``  |  `` `${when} ${minutes > 0 ? `is less than ${leadWords(minutes)} from now` : "has passed"}, so it can't be booked any more. Request a later time instead.` ``  · [lib/callWindow.ts:39](../src/lib/callWindow.ts#L39) | [lib/server/requests.ts:876](../src/lib/server/requests.ts#L876) |
|  `` answerRequest ``  ·  `` after_end ``  |  `` action === "accept" → !inWindow ``  |  `` `${when} is after testers' work on this test ends (${endText}), so it can't be booked.` ``  · [lib/callWindow.ts:45](../src/lib/callWindow.ts#L45) | [lib/server/requests.ts:878](../src/lib/server/requests.ts#L878) |
|  `` answerRequest ``  ·  `` clash ``  |  `` action === "accept" → row.repeat !== "once" → bad.length ``  |  `` `These ${row.repeat === "daily" ? "days" : "weeks"} clash: ${bad.join(" ")}` ``  | [lib/server/requests.ts:888](../src/lib/server/requests.ts#L888) |
|  `` answerRequest ``  ·  `` clash ``  |  `` action === "accept" → else row.repeat !== "once" → clashes.length ``  |  `` clashes[0] ``  | [lib/server/requests.ts:891](../src/lib/server/requests.ts#L891) |
|  `` answerRequest ``  ·  `` limit ``  |  `` action === "accept" → (await callsTaken(contractId)) >= MAX_CALLS ``  |  `` `You already have ${MAX_CALLS} calls booked or requested with ${name}. Wait until one is answered, over or cancelled, or withdraw a request.` ``  · [lib/callClash.ts:49](../src/lib/callClash.ts#L49) | [lib/server/requests.ts:894](../src/lib/server/requests.ts#L894) |
|  `` answerRequest ``  ·  `` gone ``  |  `` pick && !hit ``  |  `` That time is no longer in this request. ``  · [lib/server/requests.ts:375](../src/lib/server/requests.ts#L375) | [lib/server/requests.ts:919](../src/lib/server/requests.ts#L919) |
|  `` answerRequest ``  ·  `` gone ``  |  `` hit && rowsNow.length > 1 → !done.count ``  |  `` `${r.closedReason}.` ``  · [lib/server/requests.ts:472](../src/lib/server/requests.ts#L472)<br> `` `This request closed: ${dropReasonFor(r.closedReason, (mine ? r.fromSide : r.fromSide === "developer" ? "tester" : "developer") as Side, otherName)}.` ``  · [lib/server/requests.ts:475](../src/lib/server/requests.ts#L475)<br> `` You already withdrew this request. ``  · [lib/server/requests.ts:477](../src/lib/server/requests.ts#L477)<br> `` `${otherName} withdrew this request.` ``  · [lib/server/requests.ts:477](../src/lib/server/requests.ts#L477)<br> `` `${otherName} declined this request at ${fmtTime(r.updatedAt)}.` ``  · [lib/server/requests.ts:478](../src/lib/server/requests.ts#L478)<br> `` You already declined this request. ``  · [lib/server/requests.ts:478](../src/lib/server/requests.ts#L478)<br> `` `This time was booked at ${fmtTime(r.updatedAt)}.` ``  · [lib/server/requests.ts:480](../src/lib/server/requests.ts#L480)<br> `` `You already accepted this request at ${fmtTime(r.updatedAt)}.` ``  · [lib/server/requests.ts:480](../src/lib/server/requests.ts#L480)<br> `` `The call time ${fmtDateTime(r.startsAt)} is no longer available.` ``  · [lib/server/requests.ts:481](../src/lib/server/requests.ts#L481)<br> `` `This request closed${r.closedReason ? `: ${r.closedReason}` : ""}.` ``  · [lib/server/requests.ts:482](../src/lib/server/requests.ts#L482)<br> `` This request changed meanwhile. Press again. ``  · [lib/server/requests.ts:926](../src/lib/server/requests.ts#L926)<br> `` That time is no longer in this request. ``  · [lib/server/requests.ts:375](../src/lib/server/requests.ts#L375) | [lib/server/requests.ts:926](../src/lib/server/requests.ts#L926) |
|  `` cancelCallSet ``  ·  `` cancelled ``  |  `` !first.length ``  |  `` The remaining calls of this set were already cancelled. ``  | [lib/server/requests.ts:977](../src/lib/server/requests.ts#L977) |
|  `` cancelCallSet ``  ·  `` reason ``  |  `` !ok.ok ``  |  `` ok.message ``  · [lib/rules.ts:73](../src/lib/rules.ts#L73) | [lib/server/requests.ts:979](../src/lib/server/requests.ts#L979) |
|  `` cancelCallSet ``  ·  `` cancelled ``  |  `` !calls.length ``  |  `` The remaining calls of this set were already cancelled. ``  | [lib/server/requests.ts:983](../src/lib/server/requests.ts#L983) |

### `src/lib/server/restrictions.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` refuseDeleted ``  ·  `` deleted ``  |  `` !seen &#124;&#124; u.deletedAt <= seen.since ``  |  `` That account was deleted. ``  · [lib/server/restrictions.ts:114](../src/lib/server/restrictions.ts#L114) | [lib/server/restrictions.ts:137](../src/lib/server/restrictions.ts#L137) |
|  `` refuseDeleted ``  ·  `` deleted ``  | See handler |  `` `${ACCOUNT_DELETED} ${cap(who)} deleted it at ${fmtDateTime(at)}.` ``  · [lib/server/restrictions.ts:127](../src/lib/server/restrictions.ts#L127) | [lib/server/restrictions.ts:139](../src/lib/server/restrictions.ts#L139) |
|  `` refuseIfChangedSince ``  ·  `` changed_since ``  |  `` suspendedAt && suspendedAt > seen.since → !own ``  |  `` `${from === "preview" ? "Since your Preview" : "Since this page loaded"}, ${who} ${verb} that account's ${sideWord(side)} at ${fmtDateTime(at)}.` ``  · [lib/server/restrictions.ts:125](../src/lib/server/restrictions.ts#L125) | [lib/server/restrictions.ts:160](../src/lib/server/restrictions.ts#L160) |
|  `` refuseIfChangedSince ``  ·  `` changed_since ``  |  `` suspendedAt && suspendedAt > seen.since → own === "other" && pressing === "reinstate" ``  |  `` `${from === "preview" ? "Since your Preview" : "Since this page loaded"}, you ${verb} that account's ${sideWord(side)} in another tab at ${fmtDateTime(at)}.` ``  · [lib/server/restrictions.ts:144](../src/lib/server/restrictions.ts#L144) | [lib/server/restrictions.ts:161](../src/lib/server/restrictions.ts#L161) |
|  `` refuseIfChangedSince ``  ·  `` changed_since ``  |  `` !suspendedAt && reinstatedAt && reinstatedAt > seen.since → !own ``  |  `` `${from === "preview" ? "Since your Preview" : "Since this page loaded"}, ${who} ${verb} that account's ${sideWord(side)} at ${fmtDateTime(at)}.` ``  · [lib/server/restrictions.ts:125](../src/lib/server/restrictions.ts#L125) | [lib/server/restrictions.ts:166](../src/lib/server/restrictions.ts#L166) |
|  `` refuseIfChangedSince ``  ·  `` changed_since ``  |  `` !suspendedAt && reinstatedAt && reinstatedAt > seen.since → own === "other" && pressing === "suspend" ``  |  `` `${from === "preview" ? "Since your Preview" : "Since this page loaded"}, you ${verb} that account's ${sideWord(side)} in another tab at ${fmtDateTime(at)}.` ``  · [lib/server/restrictions.ts:144](../src/lib/server/restrictions.ts#L144) | [lib/server/restrictions.ts:167](../src/lib/server/restrictions.ts#L167) |
|  `` suspendAccount ``  ·  `` not_found ``  |  `` !u ``  |  `` That account doesn't exist. ``  | [lib/server/restrictions.ts:177](../src/lib/server/restrictions.ts#L177) |
|  `` suspendAccount ``  ·  `` choose_side ``  |  `` !side ``  |  `` Choose the side to suspend: Developer side or Tester side. ``  | [lib/server/restrictions.ts:180](../src/lib/server/restrictions.ts#L180) |
|  `` suspendAccount ``  ·  `` deleted ``  |  `` claimed.count !== 1 → now.deletedAt ``  |  `` That account was deleted. ``  · [lib/server/restrictions.ts:114](../src/lib/server/restrictions.ts#L114) | [lib/server/restrictions.ts:188](../src/lib/server/restrictions.ts#L188) |
|  `` suspendAccount ``  ·  `` already ``  |  `` claimed.count !== 1 → own ``  |  `` `You already ${what}${where === "other" ? " in another tab" : ""} at ${whenText(at)}.` ``  · [lib/server/adminRace.ts:95](../src/lib/server/adminRace.ts#L95) | [lib/server/restrictions.ts:191](../src/lib/server/restrictions.ts#L191) |
|  `` suspendAccount ``  ·  `` already ``  |  `` claimed.count !== 1 ``  |  `` `That account's ${sideWord(side)} is already suspended${by ? ` (by ${by.email})` : ""}.` ``  | [lib/server/restrictions.ts:193](../src/lib/server/restrictions.ts#L193) |
|  `` reinstateAccount ``  ·  `` not_found ``  |  `` !u ``  |  `` That account doesn't exist. ``  | [lib/server/restrictions.ts:222](../src/lib/server/restrictions.ts#L222) |
|  `` reinstateAccount ``  ·  `` choose_side ``  |  `` !side → both ``  |  `` Choose the side to reinstate: Developer side or Tester side. ``  | [lib/server/restrictions.ts:227](../src/lib/server/restrictions.ts#L227) |
|  `` reinstateAccount ``  ·  `` not_suspended ``  |  `` !side ``  |  `` That account isn't suspended. ``  | [lib/server/restrictions.ts:228](../src/lib/server/restrictions.ts#L228) |
|  `` reinstateAccount ``  ·  `` on_hold ``  |  `` side === "developer" && u.devSuspendedAt && u.holdStartedAt ``  |  `` `That developer is on a ${hold} hold: it has to clear before the developer side can be reinstated.` ``  · [lib/server/restrictions.ts:217](../src/lib/server/restrictions.ts#L217) | [lib/server/restrictions.ts:233](../src/lib/server/restrictions.ts#L233) |
|  `` reinstateAccount ``  ·  `` not_suspended ``  |  `` !start &#124;&#124; lifted.count !== 1 → own && ev ``  |  `` `You already ${what}${where === "other" ? " in another tab" : ""} at ${whenText(at)}.` ``  · [lib/server/adminRace.ts:95](../src/lib/server/adminRace.ts#L95) | [lib/server/restrictions.ts:248](../src/lib/server/restrictions.ts#L248) |
|  `` reinstateAccount ``  ·  `` not_suspended ``  |  `` !start &#124;&#124; lifted.count !== 1 ``  |  `` `That account's ${sideWord(side)} was already reinstated${by ? ` (by ${by.email})` : ""}.` ``  | [lib/server/restrictions.ts:250](../src/lib/server/restrictions.ts#L250) |
|  `` deleteAccount ``  ·  `` not_found ``  |  `` !u ``  |  `` That account doesn't exist. ``  | [lib/server/restrictions.ts:279](../src/lib/server/restrictions.ts#L279) |
|  `` deleteAccount ``  ·  `` deleted ``  |  `` u.deletedAt ``  |  `` That account was already deleted. ``  | [lib/server/restrictions.ts:280](../src/lib/server/restrictions.ts#L280) |
|  `` deleteAccount ``  ·  `` deleted ``  |  `` !claimed ``  |  `` That account was already deleted. ``  | [lib/server/restrictions.ts:290](../src/lib/server/restrictions.ts#L290) |
|  `` alreadyDeleted ``  ·  `` deleted ``  |  `` own && act ``  |  `` `You already ${what}${where === "other" ? " in another tab" : ""} at ${whenText(at)}.` ``  · [lib/server/adminRace.ts:95](../src/lib/server/adminRace.ts#L95) | [lib/server/restrictions.ts:337](../src/lib/server/restrictions.ts#L337) |
|  `` alreadyDeleted ``  ·  `` deleted ``  | See handler |  `` `That account was already deleted ${byAt(who, u.deletedAt ?? new Date())}.` ``  | [lib/server/restrictions.ts:339](../src/lib/server/restrictions.ts#L339) |
|  `` adminDeleteAccount ``  ·  `` not_found ``  |  `` !u ``  |  `` That account doesn't exist. ``  | [lib/server/restrictions.ts:348](../src/lib/server/restrictions.ts#L348) |
|  `` allowedRefusal ``  ·  `` already ``  |  `` last ``  |  `` await alreadyLine(p, last.adminId, last.createdAt, (who) => `That test's locked fields were already given 3 more changes ${byAt(who, last.createdAt)}.`, "allowed 3 more changes of this test's locked fields") ``  | [lib/server/restrictions.ts:365](../src/lib/server/restrictions.ts#L365) |
|  `` allowLockedChanges ``  ·  `` not_found ``  |  `` !t ``  |  `` That test doesn't exist. ``  | [lib/server/restrictions.ts:375](../src/lib/server/restrictions.ts#L375) |
|  `` allowLockedChanges ``  ·  `` not_locked ``  |  `` !lockedFields(countsOf(t.criticalCounts)).length && seen ``  |  `` None of that test's fields is locked. ``  | [lib/server/restrictions.ts:377](../src/lib/server/restrictions.ts#L377) |
|  `` allowLockedChanges ``  ·  `` not_locked ``  |  `` !locked.length && seen ``  |  `` None of that test's fields is locked. ``  | [lib/server/restrictions.ts:387](../src/lib/server/restrictions.ts#L387) |
|  `` pauseTest ``  ·  `` not_found ``  |  `` !t ``  |  `` That test doesn't exist. ``  | [lib/server/restrictions.ts:416](../src/lib/server/restrictions.ts#L416) |
|  `` unpauseTest ``  ·  `` not_found ``  |  `` !t ``  |  `` That test doesn't exist. ``  | [lib/server/restrictions.ts:466](../src/lib/server/restrictions.ts#L466) |
|  `` adminStopTest ``  ·  `` not_found ``  |  `` !t ``  |  `` That test doesn't exist. ``  | [lib/server/restrictions.ts:506](../src/lib/server/restrictions.ts#L506) |
|  `` previewSuspension ``  ·  `` not_found ``  |  `` !u ``  |  `` That account doesn't exist. ``  | [lib/server/restrictions.ts:541](../src/lib/server/restrictions.ts#L541) |

### `src/lib/server/session.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` getUserFromRequest ``  ·  `` account_changed ``  |  `` u && page && page !== u.id ``  |  `` You're signed in as someone else in another tab. This page is switching to that account. ``  | [lib/server/session.ts:49](../src/lib/server/session.ts#L49) |
|  `` requireUser ``  ·  `` deleted ``  |  `` !u → s?.user.deletedAt ``  |  `` This account no longer exists. ``  | [lib/server/session.ts:63](../src/lib/server/session.ts#L63) |
|  `` requireUser ``  ·  `` signed_out ``  |  `` !u ``  |  `` You're signed out. Sign in again to keep going. ``  | [lib/server/session.ts:64](../src/lib/server/session.ts#L64) |

### `src/lib/server/storage.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` headObject ``  ·  `` storage ``  |  `` !r.ok ``  |  `` The file storage didn't answer. Try again. ``  | [lib/server/storage.ts:112](../src/lib/server/storage.ts#L112) |
|  `` saveLocal ``  ·  `` empty ``  |  `` !body ``  |  `` That file is empty. ``  | [lib/server/storage.ts:123](../src/lib/server/storage.ts#L123) |
|  `` saveLocal ``  ·  `` bad_key ``  |  `` !file.startsWith(uploadDir()) ``  |  `` Bad file name. ``  | [lib/server/storage.ts:125](../src/lib/server/storage.ts#L125) |
|  `` saveLocal ``  ·  `` too_large ``  |  `` size > limit ``  |  `` tooLarge ``  · [lib/server/storage.ts:122](../src/lib/server/storage.ts#L122) | [lib/server/storage.ts:130](../src/lib/server/storage.ts#L130) |
|  `` saveLocal ``  ·  `` upload_failed ``  |  `` else e instanceof HttpError ``  |  `` The upload stopped. Try again. ``  | [lib/server/storage.ts:136](../src/lib/server/storage.ts#L136) |

### `src/lib/server/stripe.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` getStripe ``  ·  `` payments_off ``  |  `` !key ``  |  `` Payments aren't set up yet. ``  | [lib/server/stripe.ts:133](../src/lib/server/stripe.ts#L133) |
|  `` getStripe ``  ·  `` payments_off ``  |  `` paymentsOff() ``  |  `` Payments are switched off right now. Try again later. ``  · [lib/server/stripe.ts:183](../src/lib/server/stripe.ts#L183) | [lib/server/stripe.ts:134](../src/lib/server/stripe.ts#L134) |
|  `` cardGone ``  ·  `` no_card ``  | See handler |  `` Add a card in Payments first, then press Pay again. ``  · [lib/server/stripe.ts:145](../src/lib/server/stripe.ts#L145) | [lib/server/stripe.ts:181](../src/lib/server/stripe.ts#L181) |
|  `` charge ``  ·  `` card_failed ``  |  `` !dev.stripeCustomerId &#124;&#124; !dev.stripePaymentMethodId ``  |  `` No card is saved on this account. ``  · [lib/server/stripe.ts:143](../src/lib/server/stripe.ts#L143) | [lib/server/stripe.ts:247](../src/lib/server/stripe.ts#L247) |
|  `` chargeError ``  ·  `` payments_problem ``  |  `` wantsAuth(e) ``  |  `` Payments are having a problem right now. Nothing was charged; try again shortly. ``  · [lib/server/stripe.ts:297](../src/lib/server/stripe.ts#L297) | [lib/server/stripe.ts:319](../src/lib/server/stripe.ts#L319) |
|  `` chargeError ``  ·  `` card_failed ``  |  `` isCardError(e) ``  |  `` declined ``  · [lib/server/stripe.ts:309](../src/lib/server/stripe.ts#L309) | [lib/server/stripe.ts:320](../src/lib/server/stripe.ts#L320) |
|  `` chargeError ``  ·  `` payments_problem ``  | See handler |  `` Payments are having a problem right now. Nothing was charged; try again shortly. ``  · [lib/server/stripe.ts:297](../src/lib/server/stripe.ts#L297) | [lib/server/stripe.ts:323](../src/lib/server/stripe.ts#L323) |
|  `` unknownOutcome ``  ·  `` idempotency ``  |  `` t === "StripeIdempotencyError" &#124;&#124; t === "idempotency_error" ``  |  `` The payment key was used with other details. ``  | [lib/server/stripe.ts:332](../src/lib/server/stripe.ts#L332) |
|  `` unknownOutcome ``  ·  `` payment_unknown ``  |  `` t === "StripeConnectionError" &#124;&#124; t === "StripeAPIError" &#124;&#124; t === "api_error" ``  |  `` We didn't hear back from the payment service. ``  | [lib/server/stripe.ts:333](../src/lib/server/stripe.ts#L333) |
|  `` saveCardFromCheckout ``  ·  `` bad_session ``  |  `` !s.customer &#124;&#124; s.customer !== user.stripeCustomerId ``  |  `` That card setup belongs to another account. ``  | [lib/server/stripe.ts:491](../src/lib/server/stripe.ts#L491) |
|  `` saveCardFromCheckout ``  ·  `` no_card ``  |  `` !pm ``  |  `` The card wasn't saved. Try again. ``  | [lib/server/stripe.ts:494](../src/lib/server/stripe.ts#L494) |

### `src/lib/server/subscription.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` requirePerk ``  ·  `` subscription ``  | See handler |  `` `${PERKS[perk]} ${perk === "approved" ? "need" : "needs"} a subscription (${SUBSCRIPTION_PRICE}).` ``  · [lib/subscription.ts:26](../src/lib/subscription.ts#L26) | [lib/server/subscription.ts:53](../src/lib/server/subscription.ts#L53) |
|  `` canOpenAnother ``  ·  `` too_many_open ``  |  `` await hasPerks(await userOf(devId)) → open >= MAX_OPEN_TESTS ``  |  `` You have 10 open tests, the most you can have at once. Stop or close one to post another. ``  · [lib/subscription.ts:30](../src/lib/subscription.ts#L30) | [lib/server/subscription.ts:66](../src/lib/server/subscription.ts#L66) |
|  `` canOpenAnother ``  ·  `` subscription ``  |  `` open >= 1 ``  |  `` `You already have an open test. Subscribe (${SUBSCRIPTION_PRICE}) to run several at once.` ``  · [lib/subscription.ts:31](../src/lib/subscription.ts#L31) | [lib/server/subscription.ts:69](../src/lib/server/subscription.ts#L69) |
|  `` subscribe ``  ·  `` not_developer ``  |  `` !u.isDeveloper ``  |  `` Only developers subscribe. ``  | [lib/server/subscription.ts:129](../src/lib/server/subscription.ts#L129) |
|  `` subscribe ``  ·  `` restricted ``  |  `` u.holdStartedAt &#124;&#124; u.devSuspendedAt ``  |  `` You can subscribe once your account is active again. ``  · [lib/subscription.ts:43](../src/lib/subscription.ts#L43) | [lib/server/subscription.ts:131](../src/lib/server/subscription.ts#L131) |
|  `` subscribe ``  ·  `` already ``  |  `` subscribed(u, now) ``  |  `` Press Keep my subscription to keep it. ``  · [lib/server/subscription.ts:132](../src/lib/server/subscription.ts#L132)<br> `` You're already subscribed. ``  · [lib/server/subscription.ts:132](../src/lib/server/subscription.ts#L132) | [lib/server/subscription.ts:132](../src/lib/server/subscription.ts#L132) |
|  `` subscribe ``  ·  `` free ``  |  `` launch.free && !launch.until ``  |  `` Everything is free during launch: there's nothing to subscribe to yet. ``  | [lib/server/subscription.ts:134](../src/lib/server/subscription.ts#L134) |
|  `` subscribe ``  ·  `` no_card ``  |  `` stripeOn() && (!u.stripeCustomerId &#124;&#124; !u.stripePaymentMethodId) ``  |  `` Add a card first, then subscribe. ``  | [lib/server/subscription.ts:135](../src/lib/server/subscription.ts#L135) |
|  `` subscribe ``  ·  `` check_waiting ``  |  `` await openSubCheck(u.id) ``  |  `` Your Subscribe is already waiting for your bank: finish that check, or cancel it. ``  · [lib/server/subscription.ts:214](../src/lib/server/subscription.ts#L214) | [lib/server/subscription.ts:138](../src/lib/server/subscription.ts#L138) |
|  `` subscribe ``  ·  `` payments_problem ``  |  `` billingOn() → isMissing(e) → /product&#124;prod_/i.test(`${(e as { param?: string }).param ?? ""} ${(e as Error).message}`) ``  |  `` Payments are having a problem right now. Nothing was charged; try again shortly. ``  · [lib/server/stripe.ts:297](../src/lib/server/stripe.ts#L297) | [lib/server/subscription.ts:188](../src/lib/server/subscription.ts#L188) |
|  `` subscribe ``  ·  `` no_card ``  |  `` billingOn() → isMissing(e) ``  |  `` Add a card first, then subscribe. ``  | [lib/server/subscription.ts:191](../src/lib/server/subscription.ts#L191) |
|  `` subscribe ``  ·  `` card_failed ``  |  `` billingOn() → (e as Error).message === "incomplete" &#124;&#124; isCardError(e) ``  |  `` Your card was declined, so you're not subscribed. Update your card and try again. ``  | [lib/server/subscription.ts:193](../src/lib/server/subscription.ts#L193) |
|  `` subscribe ``  ·  `` payments_problem ``  |  `` billingOn() → else (e as Error).message === "incomplete" &#124;&#124; isCardError(e) ``  |  `` Payments are having a problem right now. Nothing was charged; try again shortly. ``  · [lib/server/stripe.ts:297](../src/lib/server/stripe.ts#L297) | [lib/server/subscription.ts:193](../src/lib/server/subscription.ts#L193) |
|  `` subscribe ``  ·  `` no_card ``  |  `` else billingOn() → startsCharging <= now → e instanceof HttpError && e.code === "no_card" ``  |  `` Add a card first, then subscribe. ``  | [lib/server/subscription.ts:198](../src/lib/server/subscription.ts#L198) |
|  `` subscribe ``  ·  `` card_failed ``  |  `` else billingOn() → startsCharging <= now → !r ``  |  `` Your card was declined, so you're not subscribed. Update your card and try again. ``  | [lib/server/subscription.ts:202](../src/lib/server/subscription.ts#L202) |
|  `` alreadySubscribed ``  ·  `` already ``  | See handler |  `` You're already subscribed. ``  | [lib/server/subscription.ts:211](../src/lib/server/subscription.ts#L211) |
|  `` checkRow ``  ·  `` check_waiting ``  | See handler |  `` Your Subscribe is already waiting for your bank: finish that check, or cancel it. ``  · [lib/server/subscription.ts:214](../src/lib/server/subscription.ts#L214) | [lib/server/subscription.ts:234](../src/lib/server/subscription.ts#L234) |
|  `` cancelSubscription ``  ·  `` already ``  |  `` subscribed(u, now) && u.subscriptionCanceling ``  |  `` Your subscription is already cancelled. ``  | [lib/server/subscription.ts:271](../src/lib/server/subscription.ts#L271) |
|  `` cancelSubscription ``  ·  `` none ``  |  `` !subscribed(u, now) ``  |  `` There's no subscription to cancel. ``  | [lib/server/subscription.ts:272](../src/lib/server/subscription.ts#L272) |
|  `` keepSubscription ``  ·  `` already ``  |  `` subscribed(u, now) && !u.subscriptionCanceling ``  |  `` You're already subscribed. ``  | [lib/server/subscription.ts:288](../src/lib/server/subscription.ts#L288) |
|  `` keepSubscription ``  ·  `` none ``  |  `` !u.subscriptionCanceling &#124;&#124; !subscribed(u, now) ``  |  `` There's nothing to keep. ``  | [lib/server/subscription.ts:289](../src/lib/server/subscription.ts#L289) |
|  `` keepSubscription ``  ·  `` none ``  |  `` billingOn() && u.subscriptionId && u.subscriptionId !== "manual" → gone ``  |  `` Your subscription has ended. ``  · [lib/server/subscription.ts:317](../src/lib/server/subscription.ts#L317) | [lib/server/subscription.ts:294](../src/lib/server/subscription.ts#L294) |

### `src/lib/server/teamClose.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` teamClose ``  ·  `` bad_reason ``  |  `` reason.trim().length < 10 ``  |  `` Say why the team closes these (at least 10 characters; the testers read it). ``  · [lib/moneyLines.ts:53](../src/lib/moneyLines.ts#L53) | [lib/server/teamClose.ts:65](../src/lib/server/teamClose.ts#L65) |
|  `` teamClose ``  ·  `` no_preview ``  |  `` !asked.length ``  |  `` Press Preview first: it lists what this closes. ``  | [lib/server/teamClose.ts:67](../src/lib/server/teamClose.ts#L67) |

### `src/lib/server/teamPause.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` refuseTeamPausedTest ``  ·  `` admin_paused ``  |  `` t && teamPausedNow(t) ``  |  `` `The team paused this test: ${what} waits until the pause is lifted.` ``  · [lib/restricted.ts:67](../src/lib/restricted.ts#L67) | [lib/server/teamPause.ts:22](../src/lib/server/teamPause.ts#L22) |
|  `` refuseTeamPaused ``  ·  `` admin_paused ``  |  `` testId ``  |  `` `The team paused this test: ${what} waits until the pause is lifted.` ``  · [lib/restricted.ts:67](../src/lib/restricted.ts#L67) | [lib/server/teamPause.ts:28](../src/lib/server/teamPause.ts#L28) |

### `src/lib/server/terms.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` ndaBlockCheck ``  ·  `` NDA_BLOCK_CODE ``  |  `` ndaBlocked(c) ``  |  `` Acknowledge the NDA change first. ``  · [lib/ndaNotice.ts:41](../src/lib/ndaNotice.ts#L41) | [lib/server/terms.ts:65](../src/lib/server/terms.ts#L65) |
|  `` answerTermsFirst ``  ·  `` ANSWER_TERMS_CODE ``  |  `` offer ``  |  `` Answer the new terms first: Switch or Keep. ``  · [lib/answerTerms.ts:5](../src/lib/answerTerms.ts#L5) | [lib/server/terms.ts:128](../src/lib/server/terms.ts#L128) |
|  `` decideTerms ``  ·  `` not_found ``  |  `` !c &#124;&#124; c.testerId !== tester.id ``  |  `` That session doesn't exist or isn't yours. ``  | [lib/server/terms.ts:162](../src/lib/server/terms.ts#L162) |
|  `` decideTerms ``  ·  `` gone ``  |  `` c.status !== "working" ``  |  `` Your part on this test has ended, so these terms no longer apply. ``  · [lib/server/terms.ts:57](../src/lib/server/terms.ts#L57) | [lib/server/terms.ts:166](../src/lib/server/terms.ts#L166) |
|  `` decideTerms ``  ·  `` gone ``  |  `` !newest → offer?.status === "switched" ``  |  `` You already switched to these terms. ``  | [lib/server/terms.ts:175](../src/lib/server/terms.ts#L175) |
|  `` decideTerms ``  ·  `` gone ``  |  `` !newest → offer?.status === "kept" ``  |  `` You already decided on these terms. ``  | [lib/server/terms.ts:176](../src/lib/server/terms.ts#L176) |
|  `` decideTerms ``  ·  `` gone ``  |  `` !newest ``  |  `` These terms are no longer on offer. ``  · [lib/server/terms.ts:157](../src/lib/server/terms.ts#L157) | [lib/server/terms.ts:177](../src/lib/server/terms.ts#L177) |

### `src/lib/server/testAlerts.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` alertsTest ``  ·  `` no_test ``  |  `` typeof testId !== "string" &#124;&#124; !testId ``  |  `` Which test's Alerts? Open the test page and try again. ``  | [lib/server/testAlerts.ts:6](../src/lib/server/testAlerts.ts#L6) |
|  `` alertsTest ``  ·  `` not_found ``  |  `` !t &#124;&#124; t.developerId !== userId ``  |  `` That test doesn't exist. ``  | [lib/server/testAlerts.ts:8](../src/lib/server/testAlerts.ts#L8) |

### `src/lib/server/tests.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` price ``  ·  `` bad_price ``  |  `` missing && typeof v === "string" && !v.trim() ``  |  `` missing ``  · [lib/server/tests.ts:103](../src/lib/server/tests.ts#L103) | [lib/server/tests.ts:105](../src/lib/server/tests.ts#L105) |
|  `` price ``  ·  `` bad_price ``  |  `` c == null ``  |  `` `Enter the ${label} like 7.50 (or 0 for free).` ``  | [lib/server/tests.ts:108](../src/lib/server/tests.ts#L108) |
|  `` parseListing ``  ·  `` bad_url ``  |  `` has("buildUrl") → out.buildUrl.length > LIMITS.buildUrl ``  |  `` `The build link can be up to ${LIMITS.buildUrl.toLocaleString("en-US")} characters.` ``  · [lib/listingFields.ts:17](../src/lib/listingFields.ts#L17) | [lib/server/tests.ts:126](../src/lib/server/tests.ts#L126) |
|  `` parseListing ``  ·  `` bad_url ``  |  `` has("buildUrl") → out.buildUrl && !buildUrlOk(out.buildUrl) ``  |  `` The build link must start with https:// ``  · [lib/listingFields.ts:13](../src/lib/listingFields.ts#L13) | [lib/server/tests.ts:128](../src/lib/server/tests.ts#L128) |
|  `` lockTest ``  ·  `` not_found ``  |  `` !t ``  |  `` This test was deleted. ``  | [lib/server/tests.ts:157](../src/lib/server/tests.ts#L157) |
|  `` ownTest ``  ·  `` not_found ``  |  `` !t &#124;&#124; t.developerId !== devId ``  |  `` That test doesn't exist or isn't yours. ``  | [lib/server/tests.ts:235](../src/lib/server/tests.ts#L235) |
|  `` seenDate ``  ·  `` bad_request ``  |  `` !d &#124;&#124; isNaN(d.getTime()) ``  |  `` This page is out of date. ``  | [lib/server/tests.ts:241](../src/lib/server/tests.ts#L241) |
|  `` checkPost ``  ·  `` not_developer ``  |  `` !dev.isDeveloper ``  |  `` Turn on “post tests” in your profile to post a test. ``  | [lib/server/tests.ts:252](../src/lib/server/tests.ts#L252) |
|  `` checkPost ``  ·  `` on_hold ``  |  `` await devOnHold(dev.id) ``  |  `` `${PAY_WAITS} New tests can't be posted while payments are on hold.` ``  | [lib/server/tests.ts:253](../src/lib/server/tests.ts#L253) |
|  `` checkPost ``  ·  `` bad_listing ``  |  `` errs.length ``  |  `` errs[0] ``  | [lib/server/tests.ts:263](../src/lib/server/tests.ts#L263) |
|  `` requireUniqueTitle ``  ·  `` same_title ``  | See handler |  `` `You already have a test called “${title}” (${postedAt ? `posted ${postedAt}` : "a draft"}): give this one a different name.` ``  · [lib/server/tests.ts:289](../src/lib/server/tests.ts#L289) | [lib/server/tests.ts:286](../src/lib/server/tests.ts#L286) |
|  `` requireCardToPost ``  ·  `` card_required ``  |  `` !user?.stripePaymentMethodId ``  |  `` Add a card in Payments before posting: testers' pay is charged to it. ``  | [lib/server/tests.ts:293](../src/lib/server/tests.ts#L293) |
|  `` postDraft ``  ·  `` not_draft ``  |  `` t0.status !== "draft" ``  |  `` This test was stopped. ``  · [lib/server/tests.ts:299](../src/lib/server/tests.ts#L299)<br> `` This test is already open. ``  · [lib/server/tests.ts:299](../src/lib/server/tests.ts#L299) | [lib/server/tests.ts:299](../src/lib/server/tests.ts#L299) |
|  `` postDraft ``  ·  `` not_draft ``  |  `` t.status !== "draft" ``  |  `` This test is already open. ``  | [lib/server/tests.ts:305](../src/lib/server/tests.ts#L305) |
|  `` deleteDraft ``  ·  `` deleted ``  |  `` !t && (await draftDeletedBy(dev.id, testId)) ``  |  `` You already deleted this draft. ``  · [lib/server/tests.ts:336](../src/lib/server/tests.ts#L336) | [lib/server/tests.ts:318](../src/lib/server/tests.ts#L318) |
|  `` deleteDraft ``  ·  `` not_found ``  |  `` !t &#124;&#124; t.developerId !== dev.id ``  |  `` That test doesn't exist or isn't yours. ``  | [lib/server/tests.ts:319](../src/lib/server/tests.ts#L319) |
|  `` deleteDraft ``  ·  `` not_draft ``  |  `` t.status !== "draft" ``  |  `` Only a draft can be deleted. ``  | [lib/server/tests.ts:320](../src/lib/server/tests.ts#L320) |
|  `` deleteDraft ``  ·  `` deleted ``  |  `` !gone → await draftDeletedBy(dev.id, testId) ``  |  `` You already deleted this draft. ``  · [lib/server/tests.ts:336](../src/lib/server/tests.ts#L336) | [lib/server/tests.ts:328](../src/lib/server/tests.ts#L328) |
|  `` deleteDraft ``  ·  `` not_draft ``  |  `` !gone ``  |  `` This test was stopped. ``  · [lib/server/tests.ts:329](../src/lib/server/tests.ts#L329)<br> `` Only a draft can be deleted. ``  · [lib/server/tests.ts:329](../src/lib/server/tests.ts#L329) | [lib/server/tests.ts:329](../src/lib/server/tests.ts#L329) |
|  `` editTest ``  ·  `` closed ``  |  `` (await ownTest(dev.id, testId)).status === "closed" ``  |  `` This test is closed, so it can't be edited. ``  · [lib/rules.ts:482](../src/lib/rules.ts#L482) | [lib/server/tests.ts:359](../src/lib/server/tests.ts#L359) |
|  `` editTest ``  ·  `` nda_only ``  |  `` ndaOnly && (Object.keys((body.fields ?? {}) as Record<string, unknown>).some((k) => k !== "ndaText") &#124;&#124; keysAdd.length &#124;&#124; keysRemove.length) ``  |  `` Only the NDA can be edited while this test is paused or stopped. ``  · [lib/ndaEditing.ts:3](../src/lib/ndaEditing.ts#L3) | [lib/server/tests.ts:389](../src/lib/server/tests.ts#L389) |
|  `` editTest ``  ·  `` closed ``  |  `` t.status === "closed" ``  |  `` This test is closed, so it can't be edited. ``  · [lib/rules.ts:482](../src/lib/rules.ts#L482) | [lib/server/tests.ts:390](../src/lib/server/tests.ts#L390) |
|  `` editTest ``  ·  `` open_until_passed ``  |  `` !ndaOnly && !ou.ok ``  |  `` ou.message ``  · [lib/rules.ts:73](../src/lib/rules.ts#L73) | [lib/server/tests.ts:418](../src/lib/server/tests.ts#L418) |
|  `` editTest ``  ·  `` bad_listing ``  |  `` errs.length ``  |  `` errs[0] ``  | [lib/server/tests.ts:491](../src/lib/server/tests.ts#L491) |
|  `` openDraft ``  ·  `` not_draft ``  |  `` t.status !== "draft" ``  |  `` This test was stopped. ``  · [lib/server/tests.ts:652](../src/lib/server/tests.ts#L652)<br> `` This test is already open. ``  · [lib/server/tests.ts:652](../src/lib/server/tests.ts#L652) | [lib/server/tests.ts:652](../src/lib/server/tests.ts#L652) |
|  `` openDraft ``  ·  `` not_draft ``  |  `` now.status !== "draft" ``  |  `` This test was stopped. ``  · [lib/server/tests.ts:658](../src/lib/server/tests.ts#L658)<br> `` This test is already open. ``  · [lib/server/tests.ts:658](../src/lib/server/tests.ts#L658) | [lib/server/tests.ts:658](../src/lib/server/tests.ts#L658) |
|  `` stopTest ``  ·  `` bad_reason ``  |  `` !reason ``  |  `` Say why you're stopping the test (testers read it). ``  | [lib/server/tests.ts:834](../src/lib/server/tests.ts#L834) |
|  `` stopTest ``  ·  `` bad_reason ``  |  `` reason.length < WHY_MIN_CHARS ``  |  `` Say a little more: at least 10 characters. ``  · [lib/rules.ts:1325](../src/lib/rules.ts#L1325) | [lib/server/tests.ts:835](../src/lib/server/tests.ts#L835) |
|  `` stopTest ``  ·  `` stopped ``  |  `` t.status === "stopped" ``  |  `` This test was stopped. ``  | [lib/server/tests.ts:843](../src/lib/server/tests.ts#L843) |
|  `` endEarly ``  ·  `` bad_reason ``  |  `` !reason ``  |  `` Say why you're ending their work (they read it). ``  | [lib/server/tests.ts:882](../src/lib/server/tests.ts#L882) |
|  `` endEarly ``  ·  `` bad_reason ``  |  `` reason.length < WHY_MIN_CHARS ``  |  `` Say a little more: at least 10 characters. ``  · [lib/rules.ts:1325](../src/lib/rules.ts#L1325) | [lib/server/tests.ts:883](../src/lib/server/tests.ts#L883) |
|  `` endEarly ``  ·  `` none ``  |  `` !ids.length ``  |  `` Tick at least one tester. ``  | [lib/server/tests.ts:885](../src/lib/server/tests.ts#L885) |
|  `` endEarly ``  ·  `` stopped ``  |  `` lockedTest.status === "stopped" ``  |  `` This test was stopped. ``  | [lib/server/tests.ts:891](../src/lib/server/tests.ts#L891) |
|  `` endEarly ``  ·  `` not_found ``  |  `` !c &#124;&#124; c.testId !== testId ``  |  `` Choose a tester. ``  | [lib/server/tests.ts:900](../src/lib/server/tests.ts#L900) |
|  `` endEarly ``  ·  `` gone ``  |  `` !list.length && gone.length ``  |  `` [...gone.map((g) => g.why), ...(endedElsewhere.length ? [`${andList(endedElsewhere.map((x) => x.name))}'s work already ended.`] : [])].join(" ") ``  | [lib/server/tests.ts:908](../src/lib/server/tests.ts#L908) |
|  `` endEarly ``  ·  `` gone ``  |  `` !list.length && endedElsewhere.length ``  |  `` `${andList(endedElsewhere.map((x) => x.name))}'s work already ended.` ``  | [lib/server/tests.ts:920](../src/lib/server/tests.ts#L920) |
|  `` nextRound ``  ·  `` on_hold ``  |  `` await devOnHold(dev.id) ``  |  `` `${PAY_WAITS} Your tests are paused until then.` ``  | [lib/server/tests.ts:956](../src/lib/server/tests.ts#L956) |
|  `` gapStop ``  ·  `` needs ``  |  `` body.anyway !== true ``  |  `` `Your profile ${missingNeedText(gaps)}.\n${verb === "Ask" ? "Ask to rejoin" : verb} anyway?` ``  · [lib/server/tests.ts:1032](../src/lib/server/tests.ts#L1032) | [lib/server/tests.ts:1034](../src/lib/server/tests.ts#L1034) |
|  `` gapStop ``  ·  `` needs ``  |  `` shown && gapsUnseen(gaps, shown) ``  |  `` `Your profile ${missingNeedText(gaps)}.\n${verb === "Ask" ? "Ask to rejoin" : verb} anyway?` ``  · [lib/server/tests.ts:1032](../src/lib/server/tests.ts#L1032) | [lib/server/tests.ts:1037](../src/lib/server/tests.ts#L1037) |
|  `` joinTest ``  ·  `` not_tester ``  |  `` !tester.isTester ``  |  `` Turn on “test apps, games and more” in your profile to join tests. ``  | [lib/server/tests.ts:1051](../src/lib/server/tests.ts#L1051) |
|  `` joinTest ``  ·  `` profile_first ``  |  `` !options.applicationId && !profileSaved(profile) ``  |  `` Save your tester profile first: pick the devices and languages you test on in Profile. ``  · [lib/server/tests.ts:1042](../src/lib/server/tests.ts#L1042) | [lib/server/tests.ts:1054](../src/lib/server/tests.ts#L1054) |
|  `` joinTest ``  ·  `` application_gone ``  |  `` options.applicationId → !application &#124;&#124; application.testId !== testId &#124;&#124; application.testerId !== tester.id &#124;&#124; application.status !== "pending" ``  |  `` This application is no longer waiting. ``  | [lib/server/tests.ts:1064](../src/lib/server/tests.ts#L1064) |
|  `` joinTest ``  ·  `` application_gone ``  |  `` options.applicationId → !claimed.count ``  |  `` This application is no longer waiting. ``  | [lib/server/tests.ts:1066](../src/lib/server/tests.ts#L1066) |
|  `` joinTest ``  ·  `` own ``  |  `` t.developerId === tester.id ``  |  `` You can't join your own test. ``  | [lib/server/tests.ts:1068](../src/lib/server/tests.ts#L1068) |
|  `` joinTest ``  ·  `` already ``  |  `` old && old.status === "working" ``  |  `` You've already joined this test. ``  | [lib/server/tests.ts:1072](../src/lib/server/tests.ts#L1072) |
|  `` joinTest ``  ·  `` not_again ``  |  `` old && (await tx.rating.count({ where: { contractId: old.id } })) ``  |  `` You rated this test, so you can't join it again. ``  · [lib/server/tests.ts:1074](../src/lib/server/tests.ts#L1074)<br> `` You can't join this test again. ``  · [lib/server/tests.ts:1074](../src/lib/server/tests.ts#L1074) | [lib/server/tests.ts:1074](../src/lib/server/tests.ts#L1074) |
|  `` joinTest ``  ·  `` not_again ``  |  `` old && old.status === "ended" && body.rejoinAccepted !== true && !(await tx.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } })) ``  |  `` You can't join this test again. ``  | [lib/server/tests.ts:1075](../src/lib/server/tests.ts#L1075) |
|  `` joinTest ``  ·  `` paused ``  |  `` testPaused(dev, t) ``  |  `` This test is paused right now. ``  · [lib/rules.ts:902](../src/lib/rules.ts#L902) | [lib/server/tests.ts:1077](../src/lib/server/tests.ts#L1077) |
|  `` joinTest ``  ·  `` refused ``  |  `` r.result === "refused" ``  |  `` r.message ``  · [lib/rules.ts:854](../src/lib/rules.ts#L854) | [lib/server/tests.ts:1080](../src/lib/server/tests.ts#L1080) |
|  `` joinTest ``  ·  `` listing_changed ``  |  `` r.result === "changed" ``  |  `` The developer changed this test since you opened it. Check the new terms, then press Join again to join on them. ``  | [lib/server/tests.ts:1082](../src/lib/server/tests.ts#L1082) |
|  `` joinTest ``  ·  `` blocked ``  |  `` await tx.block.count({ where: { blockerId: tester.id, blockedId: t.developerId } }) ``  |  `` `You blocked ${displayName(dev)}: unblock ${pronouns(dev.pronoun).obj} in Account → Blocked people to join.` ``  | [lib/server/tests.ts:1086](../src/lib/server/tests.ts#L1086) |
|  `` joinTest ``  ·  `` closed ``  |  `` await tx.block.count({ where: { blockerId: t.developerId, blockedId: tester.id } }) ``  |  `` This test isn't taking new testers right now. ``  | [lib/server/tests.ts:1087](../src/lib/server/tests.ts#L1087) |
|  `` joinTest ``  ·  `` nda ``  |  `` t.ndaText && body.ndaAccepted !== true && !ndaAt ``  |  `` Accept the NDA to join. ``  | [lib/server/tests.ts:1091](../src/lib/server/tests.ts#L1091) |
|  `` ownContract ``  ·  `` not_found ``  |  `` !c &#124;&#124; c.testerId !== testerId ``  |  `` That session doesn't exist or isn't yours. ``  | [lib/server/tests.ts:1139](../src/lib/server/tests.ts#L1139) |
|  `` leaveTest → refused ``  ·  `` gone ``  |  `` refusal ``  |  `` You already left this test. ``  · [lib/server/tests.ts:1157](../src/lib/server/tests.ts#L1157) | [lib/server/tests.ts:1157](../src/lib/server/tests.ts#L1157) |
|  `` sendWritten ``  ·  `` closed ``  |  `` ended ``  |  ``  ``  · [lib/rules.ts:232](../src/lib/rules.ts#L232) | [lib/server/tests.ts:1189](../src/lib/server/tests.ts#L1189) |
|  `` sendWritten ``  ·  `` uploading ``  |  `` (await db.recording.count({ where: { contractId, ...(await import("./recordings")).stillUploading("written") } })) &#124;&#124; JSON.stringify([body.answers, body.notes]).includes("[Uploading ") ``  |  `` Wait for the upload to finish before sending. ``  | [lib/server/tests.ts:1193](../src/lib/server/tests.ts#L1193) |
|  `` sendWritten ``  ·  `` bad_answers ``  |  `` missing ``  |  `` missing.message ``  · [lib/questions.ts:78](../src/lib/questions.ts#L78) | [lib/server/tests.ts:1231](../src/lib/server/tests.ts#L1231) |
|  `` sendWritten ``  ·  `` too_long ``  |  `` !long.ok ``  |  `` long.message ``  · [lib/rules.ts:73](../src/lib/rules.ts#L73) | [lib/server/tests.ts:1235](../src/lib/server/tests.ts#L1235) |
|  `` sendWritten ``  ·  `` paused ``  |  `` !sessionRefusal(c0, c0.test, displayName(c0.test.developer)) && testerPaused(c0.test.developer, c0.test) ``  |  `` `${PAUSED_RIGHT_NOW} You can send this once it resumes.` ``  · [lib/rules.ts:923](../src/lib/rules.ts#L923) | [lib/server/tests.ts:1237](../src/lib/server/tests.ts#L1237) |
|  `` sendWritten ``  ·  `` closed ``  |  `` refusal ``  |  ``  ``  · [lib/rules.ts:232](../src/lib/rules.ts#L232) | [lib/server/tests.ts:1250](../src/lib/server/tests.ts#L1250) |
|  `` sendWritten ``  ·  `` questions_changed ``  |  `` !sameQuestionWords(writtenQuestions(c), qs) ``  |  `` Your questions changed just now: nothing was sent. Check your answers and press Send Answers again. ``  · [lib/server/tests.ts:1290](../src/lib/server/tests.ts#L1290) | [lib/server/tests.ts:1253](../src/lib/server/tests.ts#L1253) |
|  `` sendRefusal ``  ·  `` paid ``  |  `` locked ``  |  ``  ``  · [lib/server/paidUpdates.ts:14](../src/lib/server/paidUpdates.ts#L14)<br> `` The team closed this for $0, so it can't be changed. ``  · [lib/moneyLines.ts:50](../src/lib/moneyLines.ts#L50)<br> `` Your written answers were already reviewed, so they can't be changed. ``  · [lib/server/paidUpdates.ts:13](../src/lib/server/paidUpdates.ts#L13)<br> `` Your recording was already reviewed, so it can't be changed. ``  · [lib/server/paidUpdates.ts:13](../src/lib/server/paidUpdates.ts#L13) | [lib/server/tests.ts:1333](../src/lib/server/tests.ts#L1333) |
|  `` sendRefusal ``  ·  `` locked ``  |  `` existing && !existing.setUntil && !answersNew && sameQuestions(latestItems(existing, qs), itemsFor(qs, answers)) ``  |  `` Your answers were already sent, so they can't be changed. Use Add to this answer under a question to add to them. ``  · [lib/rules.ts:1334](../src/lib/rules.ts#L1334) | [lib/server/tests.ts:1337](../src/lib/server/tests.ts#L1337) |
|  `` addRefusal ``  ·  `` not_sent ``  |  `` !existing ``  |  `` Send your answers first. ``  | [lib/server/tests.ts:1349](../src/lib/server/tests.ts#L1349) |
|  `` addRefusal ``  ·  `` paid ``  |  `` locked ``  |  ``  ``  · [lib/server/paidUpdates.ts:14](../src/lib/server/paidUpdates.ts#L14)<br> `` The team closed this for $0, so it can't be changed. ``  · [lib/moneyLines.ts:50](../src/lib/moneyLines.ts#L50)<br> `` Your written answers were already reviewed, so they can't be changed. ``  · [lib/server/paidUpdates.ts:13](../src/lib/server/paidUpdates.ts#L13)<br> `` Your recording was already reviewed, so it can't be changed. ``  · [lib/server/paidUpdates.ts:13](../src/lib/server/paidUpdates.ts#L13) | [lib/server/tests.ts:1351](../src/lib/server/tests.ts#L1351) |
|  `` addRefusal ``  ·  `` question_gone ``  |  `` key !== ANYTHING_ELSE_KEY && keys.indexOf(key) < 0 ``  |  `` That question isn't one of your current questions. Reload the page and add under one of them. ``  · [lib/additions.ts:83](../src/lib/additions.ts#L83) | [lib/server/tests.ts:1357](../src/lib/server/tests.ts#L1357) |
|  `` addRefusal ``  ·  `` add_full ``  |  `` !unansweredNow(existing, qs, key) && addsCounted(existing.additions, key) >= ADDITIONS_MAX ``  |  `` `You've added to ${ANYTHING_ELSE_TITLE} ${ADDITIONS_MAX} times, the most it takes.` ``  · [lib/additions.ts:61](../src/lib/additions.ts#L61)<br> `` `You've added to this answer ${ADDITIONS_MAX} times, the most it takes.` ``  · [lib/additions.ts:61](../src/lib/additions.ts#L61) | [lib/server/tests.ts:1360](../src/lib/server/tests.ts#L1360) |
|  `` addRefusal ``  ·  `` too_long ``  |  `` !long.ok ``  |  `` long.message ``  · [lib/rules.ts:73](../src/lib/rules.ts#L73) | [lib/server/tests.ts:1364](../src/lib/server/tests.ts#L1364) |
|  `` addRefusal ``  ·  `` too_short ``  |  `` chars < answerMin() ``  |  `` `Write at least ${ANSWER_MIN_CHARS} characters (${chars} so far).` ``  · [lib/questions.ts:60](../src/lib/questions.ts#L60) | [lib/server/tests.ts:1366](../src/lib/server/tests.ts#L1366) |
|  `` addWritten ``  ·  `` closed ``  |  `` ended ``  |  ``  ``  · [lib/rules.ts:232](../src/lib/rules.ts#L232) | [lib/server/tests.ts:1386](../src/lib/server/tests.ts#L1386) |
|  `` addWritten ``  ·  `` pick_question ``  |  `` !key ``  |  `` Add to one question: open it in your answers and use Add to this answer. ``  · [lib/additions.ts:81](../src/lib/additions.ts#L81) | [lib/server/tests.ts:1389](../src/lib/server/tests.ts#L1389) |
|  `` addWritten ``  ·  `` uploading ``  |  `` (await db.recording.count({ where: { contractId, ...(await import("./recordings")).stillUploading("written") } })) &#124;&#124; text.includes("[Uploading ") ``  |  `` Wait for the upload to finish before sending. ``  | [lib/server/tests.ts:1391](../src/lib/server/tests.ts#L1391) |
|  `` addWritten ``  ·  `` paused ``  |  `` !sessionRefusal(c0, c0.test, displayName(c0.test.developer)) && testerPaused(c0.test.developer, c0.test) ``  |  `` `${PAUSED_RIGHT_NOW} You can send this once it resumes.` ``  · [lib/rules.ts:923](../src/lib/rules.ts#L923) | [lib/server/tests.ts:1392](../src/lib/server/tests.ts#L1392) |
|  `` addWritten ``  ·  `` empty ``  |  `` !withoutAttachmentMarkers(text).trim() && !placedIn(await db.recording.findMany({ where: unsent, select: { id: true, filename: true } })).length ``  |  `` Write something or attach a file to add. ``  · [lib/rules.ts:1336](../src/lib/rules.ts#L1336) | [lib/server/tests.ts:1399](../src/lib/server/tests.ts#L1399) |
|  `` addWritten ``  ·  `` closed ``  |  `` refusal ``  |  ``  ``  · [lib/rules.ts:232](../src/lib/rules.ts#L232) | [lib/server/tests.ts:1425](../src/lib/server/tests.ts#L1425) |
|  `` addWritten ``  ·  `` not_sent ``  |  `` refused &#124;&#124; !existing ``  |  `` Send your answers first. ``  | [lib/server/tests.ts:1429](../src/lib/server/tests.ts#L1429) |

### `src/lib/server/users.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` requireActive ``  ·  `` suspended ``  |  `` asDev ? u.devSuspendedAt : u.testerSuspendedAt ``  |  `` Your account is suspended: your tests are paused. Contact us in Settings to appeal. ``  · [lib/server/users.ts:19](../src/lib/server/users.ts#L19)<br> `` Your account is paused. Contact support if you think this is a mistake. ``  · [lib/server/users.ts:12](../src/lib/server/users.ts#L12) | [lib/server/users.ts:77](../src/lib/server/users.ts#L77) |
|  `` requireActive ``  ·  `` held ``  |  `` u.holdStartedAt && u.isDeveloper && asDev && (opts.devSide === true &#124;&#124; opts.devSide === "auto") ``  |  `` Your tests are paused after a chargeback. Open Payments to see the steps. ``  · [lib/server/users.ts:21](../src/lib/server/users.ts#L21)<br> `` Your tests are paused until you pay what you owe. Open Payments to pay. ``  · [lib/server/users.ts:20](../src/lib/server/users.ts#L20) | [lib/server/users.ts:80](../src/lib/server/users.ts#L80) |
|  `` requireConfirmed ``  ·  `` confirm_email ``  |  `` !u.emailVerifiedAt ``  |  `` `${CONFIRM_FIRST} We sent a link to ${email}.` ``  · [lib/server/users.ts:90](../src/lib/server/users.ts#L90)<br> `` Confirm your email first. ``  · [lib/server/users.ts:89](../src/lib/server/users.ts#L89) | [lib/server/users.ts:96](../src/lib/server/users.ts#L96) |
|  `` saveProfile ``  ·  `` bad_name ``  |  `` name.length < 1 ``  |  `` Enter your name (others see it). ``  | [lib/server/users.ts:115](../src/lib/server/users.ts#L115) |
|  `` saveProfile ``  ·  `` bad_name ``  |  `` name.length > LIMITS.personName ``  |  `` `Keep your name to ${LIMITS.personName} characters.` ``  · [lib/limits.ts:54](../src/lib/limits.ts#L54) | [lib/server/users.ts:116](../src/lib/server/users.ts#L116) |
|  `` saveProfile ``  ·  `` bad_role ``  |  `` !isDeveloper && !isTester ``  |  `` Choose developer, tester, or both. ``  | [lib/server/users.ts:128](../src/lib/server/users.ts#L128) |
|  `` saveProfile ``  ·  `` bad_devices ``  |  `` testerPart && devices.length === 0 ``  |  `` Pick at least one device you play on. ``  · [lib/options.ts:6](../src/lib/options.ts#L6) | [lib/server/users.ts:137](../src/lib/server/users.ts#L137) |
|  `` saveProfile ``  ·  `` bad_languages ``  |  `` testerPart && languages.length === 0 ``  |  `` Pick at least one language you can test in. ``  · [lib/options.ts:7](../src/lib/options.ts#L7) | [lib/server/users.ts:138](../src/lib/server/users.ts#L138) |
|  `` requireCurrentTerms ``  ·  `` TERMS_UPDATED_CODE ``  |  `` body.agreeTerms !== true ``  |  `` Tick to agree to the updated Terms of Use. ``  · [lib/termsOfUse.ts:34](../src/lib/termsOfUse.ts#L34) | [lib/server/users.ts:186](../src/lib/server/users.ts#L186) |

### `src/lib/server/workWindow.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` assertWorkOpen ``  ·  `` closed ``  |  `` t.workEndedAt &#124;&#124; (t.status !== "draft" && !testPaused(t.developer, t) && at && at <= now) ``  |  `` `This test ended on ${fmtDate(at)}. Work already sent can still be paid.` ``  · [lib/server/workWindow.ts:9](../src/lib/server/workWindow.ts#L9) | [lib/server/workWindow.ts:25](../src/lib/server/workWindow.ts#L25) |


## Client notices

### `src/components/ScreenRecorder.tsx`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` ScreenRecorder → start ``  ·  `` inline ``  | See handler |  `` Screen sharing was cancelled or blocked by the browser. ``  | [components/ScreenRecorder.tsx:49](../src/components/ScreenRecorder.tsx#L49) |
|  `` ScreenRecorder → start ``  ·  `` inline ``  |  `` withMic ``  |  `` No microphone access, so this recording has no voice. ``  | [components/ScreenRecorder.tsx:54](../src/components/ScreenRecorder.tsx#L54) |


## Retry responses

### `src/app/api/invites/[id]/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` POST ``  ·  `` stop_once ``  |  `` inv.status === "replaced" → body.confirmed !== true &#124;&#124; (boxAt && boxAt < fresh.createdAt) ``  |  `` Press again to go ahead. ``  | [app/api/invites/[id]/route.ts:30](../src/app/api/invites/%5Bid%5D/route.ts#L30) |

### `src/app/api/sessions/[id]/[action]/route.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` stateMoment ``  ·  `` stop_once ``  | See handler |  `` Press again to go ahead. ``  | [app/api/sessions/[id]/[action]/route.ts:110](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L110) |

### `src/lib/server/accountChanges.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` accountGate ``  ·  `` stop_once ``  |  `` changes.length ``  |  `` Press again to go ahead. ``  | [lib/server/accountChanges.ts:72](../src/lib/server/accountChanges.ts#L72) |

### `src/lib/server/adminRace.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` stopIfChanged ``  ·  `` stop_once ``  | See handler |  `` Press again to go ahead. ``  | [lib/server/adminRace.ts:110](../src/lib/server/adminRace.ts#L110) |

### `src/lib/server/chargeback.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` reserveOwed ``  ·  `` stop_once ``  |  `` "changed" in r ``  |  `` Press again to go ahead. ``  | [lib/server/chargeback.ts:144](../src/lib/server/chargeback.ts#L144) |

### `src/lib/server/confirmAll.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` claim ``  ·  `` stop_once ``  |  `` e instanceof ItemStops ``  |  `` Press again to go ahead. ``  | [lib/server/confirmAll.ts:141](../src/lib/server/confirmAll.ts#L141) |
|  `` confirmAllPress ``  ·  `` stop_once ``  |  `` !one ``  |  `` Press again to go ahead. ``  | [lib/server/confirmAll.ts:172](../src/lib/server/confirmAll.ts#L172) |
|  `` stopIfChanged ``  ·  `` stop_once ``  | See handler |  `` Press again to go ahead. ``  | [lib/server/confirmAll.ts:264](../src/lib/server/confirmAll.ts#L264) |

### `src/lib/server/holds.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` payOwed ``  ·  `` stop_once ``  |  `` seen != null && (seen !== total &#124;&#124; (Array.isArray(body.seenIds) && (seenIds.length !== nowIds.length &#124;&#124; nowIds.some((i) => !seenIds.includes(i))))) ``  |  `` Press again to go ahead. ``  | [lib/server/holds.ts:639](../src/lib/server/holds.ts#L639) |
|  `` payOwed ``  ·  `` stop_once ``  |  `` tickMissing ``  |  `` `Tick “${OVER_PAY_TICK_LINE}” to pay.` ``  · [lib/rules.ts:1214](../src/lib/rules.ts#L1214) | [lib/server/holds.ts:642](../src/lib/server/holds.ts#L642) |
|  `` payOwed ``  ·  `` stop_once ``  |  `` r.result === "skipped" ``  |  `` Press again to go ahead. ``  | [lib/server/holds.ts:660](../src/lib/server/holds.ts#L660) |

### `src/lib/server/invites.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` inviteTesters ``  ·  `` needs_confirm ``  |  `` gaps.length && body.anyway !== true ``  |  `` "CONFIRM:" + gaps.join("\n") ``  | [lib/server/invites.ts:389](../src/lib/server/invites.ts#L389) |
|  `` inviteTesters ``  ·  `` needs_confirm ``  |  `` gaps.length && JSON.stringify(seenGaps) !== JSON.stringify(gaps) ``  |  `` "CONFIRM:" + ["What's missing changed since you looked. Press Invite anyway again to invite on this:", ...gaps].join("\n") ``  | [lib/server/invites.ts:392](../src/lib/server/invites.ts#L392) |

### `src/lib/server/joining.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` listingGate ``  ·  `` stop_once ``  |  `` r ``  |  `` r.tail ``  · [lib/server/joining.ts:135](../src/lib/server/joining.ts#L135) | [lib/server/joining.ts:111](../src/lib/server/joining.ts#L111) |

### `src/lib/server/payments.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` decideDispute → payChanged ``  ·  `` stop_once ``  | See handler |  `` Press again to go ahead. ``  | [lib/server/payments.ts:475](../src/lib/server/payments.ts#L475) |

### `src/lib/server/requests.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` devRequestTime ``  ·  `` stop_once ``  |  `` blocked.length &#124;&#124; limited.length → body.confirmed !== true &#124;&#124; body.limitSeen !== text ``  |  `` Press again to send to the others. ``  | [lib/server/requests.ts:692](../src/lib/server/requests.ts#L692) |

### `src/lib/server/stopMoment.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` stopBox ``  ·  `` stop_once ``  | See handler |  `` Press again to go ahead. ``  | [lib/server/stopMoment.ts:167](../src/lib/server/stopMoment.ts#L167) |

### `src/lib/server/terms.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` decideTerms ``  ·  `` stop_once ``  |  `` (!offer &#124;&#124; offer.id !== newest.id) && body.confirmed !== true ``  |  `` Press again to go ahead. ``  | [lib/server/terms.ts:180](../src/lib/server/terms.ts#L180) |

### `src/lib/server/testerGate.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` testerGate → staleStop ``  ·  `` stop_once ``  | See handler |  `` tail ``  · [lib/server/testerGate.ts:175](../src/lib/server/testerGate.ts#L175) | [lib/server/testerGate.ts:191](../src/lib/server/testerGate.ts#L191) |
|  `` testerGate ``  ·  `` stop_once ``  |  `` list.length ``  |  `` tail ``  · [lib/server/testerGate.ts:175](../src/lib/server/testerGate.ts#L175) | [lib/server/testerGate.ts:240](../src/lib/server/testerGate.ts#L240) |

### `src/lib/server/tests.ts`

| Handler and code | When | Wording or template | Source |
|---|---|---|---|
|  `` editTest ``  ·  `` body.ndaOnly === true ? "stop_once" : "changed" ``  |  `` stop ``  |  `` Press Save again to save. ``  · [lib/server/tests.ts:487](../src/lib/server/tests.ts#L487)<br> `` This test changed since you opened Edit. Press Save again to save your changes on top. ``  · [lib/server/tests.ts:487](../src/lib/server/tests.ts#L487) | [lib/server/tests.ts:487](../src/lib/server/tests.ts#L487) |
|  `` devGate ``  ·  `` stop_once ``  |  `` changes.length ``  |  `` Press again to go ahead. ``  | [lib/server/tests.ts:793](../src/lib/server/tests.ts#L793) |
