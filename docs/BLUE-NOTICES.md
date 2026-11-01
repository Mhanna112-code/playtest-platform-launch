# Blue notices and refusals

Code audit, Nov 1, 2026. This is a catalog of rendered notices, not a list of notification emails or bells. Wording is copied from the constructors and renderers; angle brackets are runtime substitutions. `$X` is a formatted dollar amount, `<part>` is written answers, recording or live call, and `<date/time>` is the referenced constructor's formatted value. ChangesBox's appended times use the reader's saved zone; some server-worded lines (notably adminRace.whenText) use the server's fmtTime/fmtDateTime without an explicit zone. Singular/plural alternatives remain separate where the source does.

Snapshot: `master` at `d1882f7b`, with the completed Task 12–14 behavior read from `codex/rate-all-stops`, `codex/refusal-flash` and `codex/payment-tags`. Reviewed feature commits: Task 12 df92296c, Task 13 3aecea7c, Task 14 2c5a41f3. Those branches are intentionally unmerged. Feature-source entries were read at the feature commits listed here. Source links use repository-relative paths so they remain useful after merging; before then, use `git show <commit>:<path>` for the audited unmerged version. No app code is changed by this catalog. With the owner's approval, two existing dashboard source assertions are updated to match master's §98 rows; this is the only change besides this document.

## Reading the catalog

* **S — stop once:** a blue `ChangesBox` under the pressed button, scrolled into view. It says `Your <press> didn't go through.`, then `Since you opened this page:`, the changes oldest first, and `Press <press> again to go ahead.` A new change after `boxAt` can stop the next press again. A rename alone does not stop. A line already shown by the page advances seenAt (§90); a pill outside the viewport alone is not seen. Older tester terms/call baselines are a code-level exception noted below; Task 12 normalizes Rate's baselines.
* **F — final refusal:** blue under the button, normally `Your <press> didn't go through: <reason>`. The reason does not become permission on a second press. `Answer the new terms first: Switch or Keep.` keeps its own wording. `Err` and `ChangesBox` clear after a subsequent page version (§60); a hard reload/new page clears component state. Raw local msg/error paragraphs do not all use that hook: their reset/remount lifetimes are distinguished in section 5. If a 409 redraw removes the button, `KeptRefusal` keeps one copy in the nearest surviving section, otherwise fixed at the top, until the next press or navigation to another pathname. `KEEP_MS` is infinity: there is no timer expiry. Task 13 excludes its own portal from duplicate detection and hides empty hosts (§95).
* **I — information:** does not itself reject any press. It remains while its render condition holds, unless its row explicitly says Dismiss, next press or a local success/reset. A 20-second redraw re-evaluates conditions; it is not a universal 20-second expiry.
* **Alerts:** developer checkboxes mean *ignore this category*. Tester Alerts Off suppresses ordinary tester categories, but not terms, a key marked working, own actions from another page load, or a payment on the piece being disputed. Final refusals and admin stops cannot be switched off. Join's listing gate does not filter its lines with tester Alerts Off even though its box can show an Alerts hint.

`errOf` marks HTTP 400 and 413 as red form mistakes. They are excluded from the blue refusal tables except the raw ScreenRecorder upload path, indexed explicitly below. HTTP 401 redirects to Login rather than leaving a blue refusal. 402, 403, 404, 409, 415, 429 and 5xx can be blue. An API poll/room data response is identified separately where it is not an ordinary pressed-button refusal. Sources: [client.ts](../src/lib/client.ts), [ChangesBox](../src/components/ChangesBox.tsx), [Err](../src/components/Err.tsx), [pageVersion](../src/lib/pageVersion.ts), [pressLabels](../src/lib/pressLabels.ts), [kept refusal](../src/components/KeptRefusal.tsx).

## 1. Stop-once lines: developer

The shared developer set applies test-wide to Pay / Reject, Pay more, Confirm with your bank on a piece, Stop, End early, Next round, call requests / answers / cancellations, Invite / Cancel invite, application / rejoin answers, and Edit Save when those presses remain allowed. Final state checks can refuse a press before/after the gate. Developer Rate is the narrower exception in section 2. A press answering the very item in a line drops that line through `answersIt` (§79 and Pay's joined line §89); this does not make a later different press permanently aware of that item.

Source: [live.ts](../src/lib/server/live.ts), [tests.ts devGate](../src/lib/server/tests.ts), [alerts.ts](../src/lib/alerts.ts).

| Kind | Alerts category / ability to turn off | Change represented |
| --- | --- | --- |
| joined, applied, invite, invited, full, spot_open | joins — Joins and applications | Joining, applications/rejoin asks, invite answer and full-test lines; own invites use own-action lines. |
| left | leaving — Testers leaving | Leave, finish by rating while working, removal after suspension/deletion. |
| sent | work — Work sent | Initial or updated work that can still be paid more. |
| booked, confirmed, cancelled, offered, removed, requested, withdrew_req, declined_req | calls — Call changes | Bookings, requests, answers, cancellation and older offered/removed kinds. |
| paid, rejected, choice, payment | payments — Payments (going through or failing) | Charge / Let it go, Charge becoming available, failed/settled payments. Own Pay is always through ActionLog. |
| dispute | disputes — Disputes | Tester opened a dispute. |
| admin | admin — Decisions by the team | Dispute decision / team closure. |
| info, renamed, edited, own, profile, subscription, chargeback, stop | always | Own changes, mandatory checks and restriction moments; rename alone remains information. |

### Recorded event wording and payment lines

Every row below is an event producer read by `devChanges`, or a companion live-only event. `S` uses the shared developer presses and lifetime above; `quiet` means live top box only, never a stop. Events starting `You ` are removed from the other-person feed and represented once by the own-action log. Stored metadata records (`listing_saved`, `listing_values`, `listing_save`) are parsed, not printed as JSON.

| Kind | Exact wording / variants | Stops / where / lifetime | Producer and source |
| --- | --- | --- | --- |
| `invite` | `<person> said no thanks to your invite` | S; see kind/Alerts table | `POST`; [src/app/api/invites/[id]/route.ts:48](../src/app/api/invites/[id]/route.ts#L48) |
| `key` | `<person> reported their key doesn't work` | quiet; live only | `reportKeyBroken`; [src/lib/server/accessKeys.ts:141](../src/lib/server/accessKeys.ts#L141) |
| `cancelled` | `You cancelled the call with <person> on <date/time>` | Own-action feed instead (same-page load excluded) | `devCancelCall`; [src/lib/server/calls.ts:43](../src/lib/server/calls.ts#L43) |
| `cancelled` | `<person> cancelled <pronouns(tester.pronoun).poss> call on <date/time>` | S; see kind/Alerts table | `testerCancelCall`; [src/lib/server/calls.ts:89](../src/lib/server/calls.ts#L89) |
| `chargeback` | `The team resolved the bank reversal of your $X payment` | S; see kind/Alerts table | `approveChargebackHold`; [src/lib/server/chargeback.ts:393](../src/lib/server/chargeback.ts#L393) |
| `chargeback` | `Your bank reversed your $X payment for <person>'s live call`<br>`Your bank reversed your $X payment for <person>'s recording`<br>`Your bank reversed your $X payment for <person>'s written answers`<br>`Your bank reversed your $X payment for <person>` | S; see kind/Alerts table | `chargebackOpened`; [src/lib/server/holds.ts:583](../src/lib/server/holds.ts#L583) |
| `payment` | `Your bank's chargeback of $X was reversed: $X refunded to your card.`<br>`Your bank's chargeback of $X was reversed: $X taken off what you owe.` | S; see kind/Alerts table | `chargebackWon`; [src/lib/server/holds.ts:624](../src/lib/server/holds.ts#L624) |
| `choice` | `<person> can now charge or let go of their recording`<br>`<person> can now charge or let go of their written answers` | S; see kind/Alerts table | `openCharges`; [src/lib/server/holds.ts:826](../src/lib/server/holds.ts#L826) |
| `paid` | `<person>'s call on <date/time> closed with nothing to pay` | S; see kind/Alerts table | `autoChargeCalls`; [src/lib/server/holds.ts:1104](../src/lib/server/holds.ts#L1104) |
| `paid` | `<text>` | S; see kind/Alerts table | `autoChargeCalls / logged`; [src/lib/server/holds.ts:1111](../src/lib/server/holds.ts#L1111) |
| `rejected` | `<person> let their recording go: nothing charged`<br>`<person> let their written answers go: nothing charged` | S; see kind/Alerts table | `chooseOutcome`; [src/lib/server/holds.ts:1218](../src/lib/server/holds.ts#L1218) |
| `paid` | `<person> charged $X for their recording`<br>`<person> charged $X for their written answers` | S; see kind/Alerts table | `chooseOutcome`; [src/lib/server/holds.ts:1227](../src/lib/server/holds.ts#L1227) |
| `paid` | `<person> charged $X for their recording`<br>`<person> charged $X for their written answers` | S; see kind/Alerts table | `chooseOutcome`; [src/lib/server/holds.ts:1258](../src/lib/server/holds.ts#L1258) |
| `rejected` | `<person> let their call on <date/time> go: nothing charged` | S; see kind/Alerts table | `chooseCallOutcome`; [src/lib/server/holds.ts:1300](../src/lib/server/holds.ts#L1300) |
| `paid` | `<person> charged $X for their call` | S; see kind/Alerts table | `chooseCallOutcome`; [src/lib/server/holds.ts:1307](../src/lib/server/holds.ts#L1307) |
| `paid` | `<person> charged $X for their call` | S; see kind/Alerts table | `chooseCallOutcome`; [src/lib/server/holds.ts:1334](../src/lib/server/holds.ts#L1334) |
| `paid` | `<person> charged $X for their call`<br>`<person> charged $X for their recording`<br>`<person> charged $X for their written answers` | S; see kind/Alerts table | `finishChoicePay`; [src/lib/server/holds.ts:1344](../src/lib/server/holds.ts#L1344) |
| `applied` | `<person> applied to join` | S; see kind/Alerts table | `apply`; [src/lib/server/joining.ts:256](../src/lib/server/joining.ts#L256) |
| `applied` | `<person> withdrew their application` | S; see kind/Alerts table | `withdrawApplication`; [src/lib/server/joining.ts:265](../src/lib/server/joining.ts#L265) |
| `applied` | `0 waiting application was accepted when you switched to joins instantly`<br>`0 waiting applications were accepted when you switched to joins instantly` | S; see kind/Alerts table | `onSwitchToAnyone`; [src/lib/server/joining.ts:379](../src/lib/server/joining.ts#L379) |
| `applied` | `<person> asks to rejoin` | S; see kind/Alerts table | `askToRejoin`; [src/lib/server/joining.ts:455](../src/lib/server/joining.ts#L455) |
| `paid` | `You paid <person> $X for the live call`<br>`You paid <person> $X for the recording`<br>`You paid <person> $X for the written answers` | Own-action feed instead (same-page load excluded) | `finishReviewPay`; [src/lib/server/payments.ts:202](../src/lib/server/payments.ts#L202) |
| `dispute` | `<person> disputed the pay for their live call`<br>`<person> disputed the pay for their recording`<br>`<person> disputed the pay for their written answers` | S; see kind/Alerts table | `openDispute`; [src/lib/server/payments.ts:248](../src/lib/server/payments.ts#L248) |
| `admin` | `The team decided <person>'s dispute: raised the pay to $X ($X more)`<br>`The team decided <person>'s dispute: kept the pay at $X (rejected)`<br>`The team decided <person>'s dispute: kept the pay at $X` | S; see kind/Alerts table | `decideDispute`; [src/lib/server/payments.ts:368](../src/lib/server/payments.ts#L368) |
| `paid` | `You paid <person> $0 more for the updated recording`<br>`You paid <person> $0 more for the updated written answers` | Own-action feed instead (same-page load excluded) | `closeUpdateAtZero`; [src/lib/server/payments.ts:581](../src/lib/server/payments.ts#L581) |
| `paid` | `You paid <person> $X extra for the live call`<br>`You paid <person> $X extra for the recording`<br>`You paid <person> $X extra for the written answers` | Own-action feed instead (same-page load excluded) | `finishExtraPay`; [src/lib/server/payments.ts:599](../src/lib/server/payments.ts#L599) |
| `left` | `<person> finished their part (rated you)` | S; see kind/Alerts table | `testerRate`; [src/lib/server/ratings.ts:246](../src/lib/server/ratings.ts#L246) |
| `rated` | `<person> rated you` | quiet; live only | `testerRate`; [src/lib/server/ratings.ts:247](../src/lib/server/ratings.ts#L247) |
| `afterPaid.atCap ? "sentpaid" : "sent` | `<person> sent an updated version of <pronouns(tester.pronoun).poss> recording (already paid the most)`<br>`<person> sent an updated version of <pronouns(tester.pronoun).poss> recording after you paid` | sent: S under Work sent; sentpaid (already paid the most): quiet live-only | `sendRecording`; [src/lib/server/recordings.ts:189](../src/lib/server/recordings.ts#L189) |
| `sent` | `<person> updated <pronouns(tester.pronoun).poss> recording`<br>`<person> sent <pronouns(tester.pronoun).poss> recording` | S; see kind/Alerts table | `sendRecording`; [src/lib/server/recordings.ts:190](../src/lib/server/recordings.ts#L190) |
| `booked` | `You booked a call with <person> for <date/time>`<br>`<person> booked a call for <date/time>` | You variant uses own-action feed; other-person variant is S in the kind category | `bookAt`; [src/lib/server/requests.ts:209](../src/lib/server/requests.ts#L209) |
| `requested` | `You requested daily calls (<r.count> days) from <date/time> with <ok.length> tester`<br>`You requested daily calls (<r.count> days) from <date/time> with <ok.length> testers`<br>`You requested daily calls (<r.count> weeks) from <date/time> with <ok.length> tester`<br>`You requested daily calls (<r.count> weeks) from <date/time> with <ok.length> testers`<br>`You requested daily calls (until cancelled) from <date/time> with <ok.length> tester`<br>`You requested daily calls (until cancelled) from <date/time> with <ok.length> testers`<br>`You requested weekly calls (<r.count> days) from <date/time> with <ok.length> tester`<br>`You requested weekly calls (<r.count> days) from <date/time> with <ok.length> testers`<br>`You requested weekly calls (<r.count> weeks) from <date/time> with <ok.length> tester`<br>`You requested weekly calls (<r.count> weeks) from <date/time> with <ok.length> testers`<br>`You requested weekly calls (until cancelled) from <date/time> with <ok.length> tester`<br>`You requested weekly calls (until cancelled) from <date/time> with <ok.length> testers`<br>`You requested a call from <date/time> with <ok.length> tester`<br>`You requested a call from <date/time> with <ok.length> testers` | Own-action feed instead (same-page load excluded) | `devRequestTime`; [src/lib/server/requests.ts:351](../src/lib/server/requests.ts#L351) |
| `requested` | `<person> requested daily calls (<r.count> days) from <date/time>`<br>`<person> requested daily calls (<r.count> weeks) from <date/time>`<br>`<person> requested daily calls (until cancelled) from <date/time>`<br>`<person> requested weekly calls (<r.count> days) from <date/time>`<br>`<person> requested weekly calls (<r.count> weeks) from <date/time>`<br>`<person> requested weekly calls (until cancelled) from <date/time>`<br>`<person> requested a call from <date/time>`<br>`<person> requested a call for <date/time>` | S; see kind/Alerts table | `testerRequestTime`; [src/lib/server/requests.ts:398](../src/lib/server/requests.ts#L398) |
| `status === "withdrawn" ? "withdrew_req" : "declined_req` | `You withdrew a call request for <date/time>`<br>`You withdrew <person>'s call request for <date/time>`<br>`You declined a call request for <date/time>`<br>`You declined <person>'s call request for <date/time>`<br>`<person> withdrew a call request for <date/time>`<br>`<person> declined a call request for <date/time>` | You variant uses own-action feed; other-person variant is S in the kind category | `answerRequest`; [src/lib/server/requests.ts:483](../src/lib/server/requests.ts#L483) |
| `cancelled` | `You cancelled the daily calls from <date/time> (<calls.length> left)`<br>`You cancelled the weekly calls from <date/time> (<calls.length> left)`<br>`<person> cancelled the daily calls from <date/time> (<calls.length> left)`<br>`<person> cancelled the weekly calls from <date/time> (<calls.length> left)` | You variant uses own-action feed; other-person variant is S in the kind category | `cancelCallSet`; [src/lib/server/requests.ts:515](../src/lib/server/requests.ts#L515) |
| `left` | `Deleted account left the test`<br>`<person> left the test` | S; see kind/Alerts table | `removeTester`; [src/lib/server/restrictions.ts:76](../src/lib/server/restrictions.ts#L76) |
| `subscription` | `Your subscription ended.` | S; see kind/Alerts table | `endSubscription`; [src/lib/server/subscription.ts:241](../src/lib/server/subscription.ts#L241) |
| `admin` | `The team closed <list.length> open review on this test for $0: “<reason>”`<br>`The team closed <list.length> <one>s on this test for $0: “<reason>”` | S; see kind/Alerts table | `tellEveryone`; [src/lib/server/teamClose.ts:115](../src/lib/server/teamClose.ts#L115) |
| `terms` | `<person> switched to the new terms` | quiet; live only | `decideTerms`; [src/lib/server/terms.ts:118](../src/lib/server/terms.ts#L118) |
| `full` | `<test> is full: closed <apps.length> application. <invs.length> invite stays open until a spot opens`<br>`<test> is full: closed <apps.length> application. <invs.length> invites stay open until a spot opens`<br>`<test> is full: closed <apps.length> application`<br>`<test> is full: closed <apps.length> applications. <invs.length> invite stays open until a spot opens`<br>`<test> is full: closed <apps.length> applications. <invs.length> invites stay open until a spot opens`<br>`<test> is full: closed <apps.length> applications`<br>`<test> is full. <invs.length> invite stays open until a spot opens`<br>`<test> is full. <invs.length> invites stay open until a spot opens`<br>`<test> is full` | S; see kind/Alerts table | `closeOnFull`; [src/lib/server/tests.ts:176](../src/lib/server/tests.ts#L176) |
| `listingFields.length ? "edited" : "edited_spots` | `The listing was edited: <items>` | Edit version fallback; normal current Save uses the own-action/listing feed | `editTest`; [src/lib/server/tests.ts:452](../src/lib/server/tests.ts#L452) |
| `info` | `<person> changed <people / items>` | S; see kind/Alerts table | `editTest`; [src/lib/server/tests.ts:501](../src/lib/server/tests.ts#L501) |
| `options.quietJoinEvent === true ? "auto_joined" : "joined` | `<person> joined again`<br>`<person> joined` | joined: S under Joins; auto_joined: quiet/suppressed, aggregate accepted-applications line instead | `joinTest`; [src/lib/server/tests.ts:952](../src/lib/server/tests.ts#L952) |
| `left` | `<person> left the test` | S; see kind/Alerts table | `leaveTest`; [src/lib/server/tests.ts:1002](../src/lib/server/tests.ts#L1002) |
| `afterPaid.atCap ? "sentpaid" : "sent` | `<person> sent an updated version of <pronouns(tester.pronoun).poss> written answers (already paid the most)`<br>`<person> sent an updated version of <pronouns(tester.pronoun).poss> written answers after you paid` | sent: S under Work sent; sentpaid (already paid the most): quiet live-only | `sendWritten`; [src/lib/server/tests.ts:1072](../src/lib/server/tests.ts#L1072) |
| `sent` | `<person> updated <pronouns(tester.pronoun).poss> written answers`<br>`<person> sent <pronouns(tester.pronoun).poss> written answers` | S; see kind/Alerts table | `sendWritten`; [src/lib/server/tests.ts:1073](../src/lib/server/tests.ts#L1073) |
| `subscription` | `Free during launch ended: the extras need a subscription now.` | S; see kind/Alerts table | `freeLaunchNotices`; [src/lib/server/subscription.ts:415](../src/lib/server/subscription.ts#L415) |
| terms (stacked) | `<count> testers switched to the new terms` | quiet; multiple switches on one UTC day, at the latest time | [stackSwitches](../src/lib/server/live.ts) |

The following synthesized lines do not depend on a stored event's literal text:

| Exact wording | Who / trigger | Stops / Alerts / place / lifetime |
| --- | --- | --- |
| Payment failed on &lt;test&gt;: $X to &lt;tester&gt; for the &lt;part&gt; · pay what you owe in Payments | Developer; an owed payment declined, including another test | S; payments; shared developer gate; keyed by payment. |
| Payment went through on &lt;test&gt;: $X to &lt;tester&gt; for the &lt;part&gt; | Developer; a payment settled | S payments unless it had owedUntil: then quiet live-only (§78). |
| On &lt;test&gt;: &lt;event with its first letter lowercased&gt; | Developer; another test has a chargeback/payment event | S; chargeback always, payment under payments. |
| You saved the listing in another tab | Developer; listing save(s) from another load collapsed to one latest line | S always; See it marks the union of changed fields. Rename-only is quiet. |
| You re-sent &lt;tester&gt;'s invite (the listing changed) | Developer; Save re-sent an invite | S always; separate consequence beside the listing line. |
| You closed &lt;tester&gt;'s application (the listing changed) | Developer; Save closed an application | S always. |
| You closed &lt;tester&gt;'s invite (fewer spots) | Developer; Save reduced spots | S always; existing trailing parenthesis is retained. |
| You didn't re-invite &lt;tester&gt; (the listing changed) | Developer; changed listing could not re-invite them | S always. |

### Own actions in another tab, device or page load

[ActionLog producers](../src/lib/server/actionText.ts) and [ownChanges](../src/lib/server/live.ts) use `You <past-tense action> in another tab` unless the saved line already starts `You `. Developer/tester ActionLog compares body.tab / x-tab (the browser-document TAB); a hard reload gives a new TAB. Admin race tracking uses x-load and changes it for each page navigation too (§51). An SPA navigation can reuse the developer/tester TAB; see Things that look odd. Developer gate: all logged actions stop all shared developer presses, including Alerts Off (§67). Tester gate: all these own changes always stop, including Alerts Off (§61). Rate itself is not logged by the tester; repeated Rate is a final refusal. Chat and Join call are not stop-once ActionLog presses.

| Who | Exact action fragments (each takes the wrapper above) |
| --- | --- |
| Developer | `opened the test`<br>`stopped the test`<br>`ended <testers>'s work early`<br>`started the next round` |
| Developer | `paid <tester> $X for the <part>`<br>`rejected <tester>'s <part>`<br>`paid <tester> $X more for their <part>` |
| Developer | `invited <testers>`<br>`cancelled <tester>'s invite`<br>`accepted <tester>'s application`<br>`declined <tester>'s application` |
| Developer | `requested a call with <testers> for <date/time>`<br>`sent a call request`<br>`booked a call with <testers> for <date/time>`<br>`booked a call for <date/time>` |
| Developer | `withdrew a call request for <date/time>`<br>`accepted <tester>'s call request for <date/time>`<br>`declined <tester>'s call request for <date/time>` |
| Developer | `cancelled the call with <tester> on <date/time>`<br>`cancelled the rest of a daily / weekly set of calls with <tester>`<br>`reported a problem with the call with <tester> on <date/time>` |
| Developer | `added your side to a dispute`<br>`rated <tester>` |
| Tester | `left the test`<br>`sent your written answers`<br>`sent your updated answers`<br>`sent your recording`<br>`sent your updated recording` |
| Tester | `switched to the new terms`<br>`kept your current terms`<br>`opened a dispute` |
| Tester | `charged <dev> $X for your <part>`<br>`let your <part> go` |
| Tester | `sent a call request`<br>`requested a call (pick one of <count> times)`<br>`requested a call for <date/time>`<br>`booked a call for <date/time>` |
| Tester | `accepted the call request for <date/time>`<br>`declined the call request for <date/time>`<br>`withdrew your call request for <date/time>` |
| Tester | `cancelled the call on <date/time>`<br>`cancelled the rest of a daily / weekly set of calls`<br>`reported a problem with the call on <date/time>` |
| Tester, Join page | `joined this test`<br>`applied to join`<br>`asked to rejoin`<br>`withdrew your application`<br>`said no thanks to the invite` |

Edit initially records `You saved the listing in another tab: <fields>[; this <consequences>]` or `You changed the listing in another tab: <consequences>`. The test-page gate collapses its listing part to the short wording above; consequences remain their own lines. Edit Save additionally says `<field>: your version will replace the one saved in another tab at <time>.`, lists Before / What you typed, and uses the same box for mandatory/disjoint changes. A Next round made elsewhere links `You started the next round in another tab` to that draft.

### Invite's additional mandatory checks

These appear in the same S box on Invite / Invite anyway; all of these extra checks are always active rather than an Alerts type. devChanges filters the ordinary event feed, but devGate appends extraChanges afterward without ignoredAlerts filtering; that also makes the ticked-person joined/ineligible extras mandatory. [invites.ts](../src/lib/server/invites.ts), [testerState.ts](../src/lib/testerState.ts).

| Exact wording | Trigger |
| --- | --- |
| The test's requirements changed: Devices: &lt;before&gt; → &lt;after&gt; · Languages: &lt;before&gt; → &lt;after&gt; | Only changed requirements included; no requirements is any. |
| &lt;tester&gt; now lists &lt;items&gt;, which this test needs. | They gained at least one required match. |
| &lt;tester&gt; no longer lists &lt;items&gt;, which this test needs. | They lost every match of a required kind. |
| &lt;tester&gt; now lists &lt;added&gt; but no longer lists &lt;removed&gt; (this test needs &lt;needs&gt;). | Both kinds of change, net since displayed. |
| &lt;tester&gt; got their first rating: &lt;stars&gt; | Previously No ratings yet; now a first revealed rating. |
| &lt;tester&gt;'s rating went from &lt;before&gt; to &lt;after&gt; | At least one full star difference. |
| &lt;tester&gt; joined this test, so they're no longer in your invite list | Ticked person joined; actual constructor uses their saved pronoun. |
| &lt;tester&gt; can't be invited right now | Ticked tester became suspended. |
| &lt;tester&gt; is no longer in your list | Block was added. |
| &lt;tester&gt; can't join more tests right now | They reached the active-test limit elsewhere. |

### Account-page stops (both sides)

Settings / profile Save and Payments presses use `Changed in another tab or device since you opened this page:`. No Alerts switch. `<field>: <before> → <after>` uses `none` for an empty value; a whole action line such as `Password changed` uses its producer's wording. Same-value submissions and net changes that cancel out are removed. These S lines stop the next relevant press on that account page, including Stripe-bound Change card / payout setup forms. [accountChanges.ts](../src/lib/server/accountChanges.ts). Exact field/action producers are included in the account appendix below.

### Other mandatory stop boxes

These have S lifetime, no Alerts override, and appear under the named button:

| Who / press | Exact line | Trigger / next press | Source |
| --- | --- | --- | --- |
| Developer / Pay what you owe | `Another payment failed meanwhile: <payments>. New total $X. Press again to pay $X.` | The displayed owed IDs/total changed; every fresh item is a failed payment. Second press uses the new IDs and total. | [holds.ts](../src/lib/server/holds.ts#L367) |
| Developer / Pay what you owe | `Added to what you owe meanwhile: <payments>. New total $X. Press again to pay $X.` | A Charge or reversal added an item, rather than only failed payments. | [holds.ts](../src/lib/server/holds.ts#L367) |
| Developer / Pay what you owe | `Your bank's chargeback of $X was reversed. Now $X. Press again to pay $X.` | Previously displayed debt was won/reversed; multiple reversal sentences join with `; `. | [holds.ts](../src/lib/server/holds.ts#L369) |
| Developer / Pay what you owe | `What you owe changed: now $X. Press again to pay $X.` | Other net debt change. | [holds.ts](../src/lib/server/holds.ts#L370) |
| Developer / Request a call | `<tester> already has 3 requests waiting with you.` / `<testers> already have 3 requests waiting with you.` | Some selected people hit the pending-request limit. The same box includes any clash/cap sentences. Tail: `Press again to send to the others (<testers>).` A changed `limitSeen` stops again. | [requests.ts](../src/lib/server/requests.ts#L337) |
| Tester / Switch or Keep | `<dev> changed the terms again: <diff>` | The offer being answered was replaced. Tail: `Press again to decide on these newest terms.` Mandatory even Alerts Off; a missing/no-longer-open offer is instead a final refusal. | [terms.ts](../src/lib/server/terms.ts#L101) |

### Account-change line names

These are always S on the account scope indicated, under its next pressed button; second press saves/continues, and later redraw/reload clears the old box. Names and Sides appear on both Profile and Settings; Pronoun, Devices, Languages and Bio on Profile. Password is Settings. Card, Payout account and Subscription are Payments. No Alerts option applies.

| Exact wording | Trigger / values | Source |
| --- | --- | --- |
| `Name: <before> → <after>` / `Name changed` | Other-load profile save; values longer than 60 characters use changed. | [users.ts](../src/lib/server/users.ts#L135) |
| `Pronoun: <before> → <after>` / `Pronoun changed` | Saved profile pronoun; unset reads `not set`. | [users.ts](../src/lib/server/users.ts#L135) |
| `Sides: <before> → <after>` | Each value is developer, tester, developer and tester, or none. | [account side](../src/app/api/account/side/route.ts#L24) |
| `Devices: <before> → <after>` / `Devices changed` | Ordered device list; empty reads none. | [users.ts](../src/lib/server/users.ts#L135) |
| `Languages: <before> → <after>` / `Languages changed` | Ordered language list; empty reads none. | [users.ts](../src/lib/server/users.ts#L135) |
| `Bio changed` / `Bio: <before> → <after>` | Bio is long / short respectively. | [users.ts](../src/lib/server/users.ts#L135) |
| `Password changed at <time>` | Password changed elsewhere; time added by account-at renderer. | [passwords.ts](../src/lib/server/passwords.ts#L207) |
| `Card: <before> → <after>` | Card saved elsewhere; each label is `<Brand> ending <last4>`, `Card ending <last4>`, `a card` or `no card`. | [stripe.ts](../src/lib/server/stripe.ts#L359) |
| `Payout account: not connected → connected` / reverse | Payout readiness changed. | [stripe.ts](../src/lib/server/stripe.ts#L419) |
| `Subscription: cancelled, ends <date>` | Cancel succeeded elsewhere. | [subscription route](../src/app/api/payments/subscription/route.ts#L27) |
| `Subscription: kept, renews <date>` / `Subscription: active, renews <date>` | Keep / Subscribe succeeded elsewhere. | [subscription route](../src/app/api/payments/subscription/route.ts#L27) |


## 2. Stop-once lines: tester and Join / Rate

The tester's shared gate applies to Switch / Keep, written Send, recording Send, Charge / Let it go, Dispute, Leave, call Request / Accept / Decline / Withdraw / Cancel and (Task 12 §93) Rate. Block does not stop. An ended/stopped/paused test still uses this gate for presses that remain allowed. `answersIt` drops the current request/offer/piece being answered. One box combines the shared changes with Rate's stop/pause moment; `boxAt` makes the second press continue without a second box for the other source.

Task 12 normalizes the gate's older `pageSeenAt`/`loadedAt` baselines to `seenAt` when the page already showed the update (§90). Rate sends the shared markers, including the per-load identity. Developer Rate remains unchanged. Rate state is checked first: after close-out it refuses `Rating closed on <date>.` The older-baseline distinction for other shared tester presses is recorded under Things that look odd.

| Kind | Exact wording | Trigger / Alerts |
| --- | --- | --- |
| terms | &lt;dev&gt; offered you the new terms: Switch or Keep below | An open/superseded offer since the unseen baseline; always, even Alerts Off. |
| dispute | &lt;dev&gt; added their side to your dispute | Developer side added; ordinary Alerts. |
| paid | &lt;dev&gt; paid $X for your &lt;part&gt; | New review, excluding tester choices / delayed duplicates; ordinary Alerts. |
| rejected | &lt;dev&gt; rejected your &lt;part&gt; | New rejection; ordinary Alerts. |
| paid | The team closed your &lt;part&gt; for $0 | Team-closed review; ordinary Alerts. |
| paid | &lt;dev&gt; paid you $X more for your &lt;part&gt; | Settled extra payment; ordinary Alerts. |
| requested | &lt;dev&gt; requested a call for &lt;date/time&gt; | New developer request; ordinary Alerts. |
| requested | &lt;dev&gt; requested a call (pick one of &lt;count&gt; times) | Multi-row request; ordinary Alerts. |
| requested | &lt;dev&gt; requested daily calls from &lt;date/time&gt;[ (until cancelled)] | Repeating request; weekly uses weekly instead of daily; suffix only uncounted. Ordinary Alerts. |
| requested | &lt;dev&gt; withdrew the request for &lt;request wording above&gt; | Developer withdrew; ordinary Alerts. |
| requested | The call time &lt;date/time&gt; is no longer available: another tester took it | Another person took offered time; ordinary Alerts. |
| requested | The call time &lt;date/time&gt; is no longer available | Request closed except own/end consequences; ordinary Alerts. |
| requested | &lt;dev&gt; declined your call request for &lt;date/time&gt; | Tester request declined; ordinary Alerts. |
| booked | Booked: &lt;dev&gt; asked for the same time, &lt;date/time&gt; | Automatic match; ordinary Alerts. |
| booked | &lt;dev&gt; accepted your call request: &lt;date/time or repeating request wording&gt; | Developer accepted; ordinary Alerts. |
| cancelled | Your call on &lt;date/time&gt; was cancelled | Other side / system cancelled, excluding end-of-work consequences; ordinary Alerts. |
| keyfixed | The developer marked your key as working (&lt;key&gt;) | Working key marked fixed; always, Alerts Off too. |
| keygiven | &lt;dev&gt; gave you an access key for “&lt;test&gt;” | Keyless test gained keys; ordinary Alerts; See it opens key box. |
| info / renamed | &lt;dev&gt; edited the listing | Listing save collapsed to one line with See it; ordinary Alerts. Rename alone never stops. |
| payment | &lt;dev&gt;'s payment for your &lt;part&gt;[ on &lt;test&gt;] ($X) is delayed. You'll be told when it arrives. | Owed/deferred/declined owed payment; ordinary Alerts, own developer sessions only. |
| paid | &lt;dev&gt; paid $X for your &lt;part&gt;[ on &lt;test&gt;] | Delayed payment settled; replaces delayed line by payment key; ordinary Alerts. |
| admin | The team decided your dispute: the pay was raised to $X | Decision above original review; ordinary Alerts. |
| admin | The team decided your dispute: the pay stays at $X | No raise; ordinary Alerts. |
| own | You &lt;tester action from section 1&gt; in another tab | Always, including Alerts Off; all later shared presses. |

For Dispute, any payment line on the piece being disputed is mandatory even with Alerts Off (§68). `KINDS` also includes `info`, `payment`, `admin`, `own`, `dispute`, and explicitly adds renamed/keyfixed/keygiven. Call changes counted from loadedAt in the older shared gate; the page-shown rule and Task 12 Rate normalization must be distinguished from that historical comment. [testerGate.ts](../src/lib/server/testerGate.ts), [testerPaymentChanges](../src/lib/server/live.ts), [delayedPayLine](../src/lib/rules.ts).

### Join page

Join / Apply to join / Ask to rejoin / Withdraw application / No thanks share one box: all listing edits, own other-load actions, and these lines. Alerts Off is passed to the box for its controls but is not used to filter `joinStopList`. A Join answering the invite's own line drops it. No thanks drops full / spot_open lines. The tail is `Press again to <verb> on the current listing.` or `Press again to go ahead.` for Withdraw / No thanks. Rejoin after leaving also includes the tester set above except terms offers; the current listing replaces those.

| Exact wording | Trigger |
| --- | --- |
| &lt;dev&gt; changed the NDA: read and accept it again below | Join listing Save changed NDA; its tick clears. |
| &lt;test&gt; is full: your application was closed | Application closed because full. |
| &lt;dev&gt; made the test invite only: your application was closed | Join mode changed. |
| &lt;dev&gt; changed the listing: your application was closed | Other listing edit closed application. |
| &lt;test&gt; is full right now. Your invite stays open; we'll tell you when a spot opens. | Open invite when test fills. |
| &lt;spot-open event wording&gt; | Spot opened with open invite; producer shown in section 1. |
| &lt;dev&gt; changed the listing: here's a new invite on the updated listing | Old invite replaced; fresh invite exists. |
| &lt;dev&gt; changed the listing: your invite closed (no spots left) | Replaced invite without a fresh one. |

Blocked application wording comes from `appClosedLine`: see the common constructor index below. A rename alone is informational and is listed only with some other stopping change.

### Stop / pause moments and developer Rate

Pay, Pay more, Charge / Let it go and Rate can stop once for a stop or early ending newer than the page baseline. Allowed presses on a paused test can similarly show its pause moment. These are always active and already contain their time, so no second time is appended. A team Stop never names its admin to testers. The exact moment constructors are indexed below. Developer Rate stops only for its test/contract stop moment and `The team decided <tester>'s dispute: <decision>` for that shared work; ordinary joins, listing edits, keys, call changes and own actions do not stop it. Its gate does not consult ignoredAlerts, so those stop moments and dispute-decision lines cannot be turned off there. A new open dispute refuses Rate instead. [stopMoment.ts](../src/lib/server/stopMoment.ts), [ratings.ts](../src/lib/server/ratings.ts).

## 3. Admin stops

All admin S lines use `Since this page loaded:` and the same first-press/boxAt rule. Alerts never applies. The page passes `since`; an older API call without it keeps the old no-gate behavior. Actions made on this very page load are excluded. Own actions on another load use `You <action> in another tab at <time>.`; other admins use `<admin email> <action> at <time>.`, with `an admin (deleted)` when appropriate. Final impossible actions are F refusals, not a second S box.

Source: [adminRace.ts](../src/lib/server/adminRace.ts), [restrictions](../src/lib/server/restrictions.ts), [hold approvals](../src/lib/server/holds.ts), [chargeback approvals](../src/lib/server/chargeback.ts), [outages](../src/lib/server/outages.ts).

| Exact action fragment (other admin) | Own other-load fragment | Which presses / target |
| --- | --- | --- |
| paused the test | paused this test | Pause / Lift / Stop / Extend / Close now / Allow changes / team close on that test. |
| lifted the pause | lifted the pause on this test | Same test gates. |
| stopped the test | stopped this test | Same target; impossible new action refuses. |
| extended the closing date | extended this test's closing date | Same test gates. |
| closed the test | closed this test | Same test gates. |
| allowed 3 more changes of the locked fields | allowed 3 more changes of this test's locked fields | Same test gates. |
| closed the test's open reviews for $0 | closed this test's open reviews for $0 | Same test gates / team-close preview. |
| approved lifting the hold | approved lifting the hold | Approve / Don't approve on chargeback hold. |
| didn't approve lifting the hold (the reservation was released) | didn't approve lifting the hold (the reservation was released) | Same hold gates. |
| suspended the &lt;developer / tester&gt; side | suspended the &lt;developer / tester&gt; side | Suspend / Reinstate / Delete / team-close / hold actions on that account as selected by gate. |
| reinstated the &lt;developer / tester&gt; side | reinstated the &lt;developer / tester&gt; side | Same account gates. |
| closed &lt;count&gt; open reviews for $0 | closed &lt;count&gt; open reviews for $0 | Account team-close / hold approvals. |

Decide has its own mandatory line: `<dev> added their side at <time>: read it, then press Decide again.` and tail `Press Decide again to go ahead.` It triggers when the developer's side is newer than the dispute panel's shown time. Outage Approve after Dismiss (or the reverse), Mark replied already done, and concurrent suspension/deletion can instead be final refusals naming the prior actor/time; their exact constructors appear in section 4.

## 4. Final refusals, grouped by press

Every row in the main tables is an actual non-400/non-413 `HttpError` site in the API/server tree (401 login redirects excluded). Shared checks are included because they propagate to these presses. `stop_once` constructors belong to sections 1–3, not this table. `needs_confirm` / `CONFIRM:` rows open the named confirmation rather than grant permission. A poll/room access error may redirect or close its page instead of showing an under-button box; those rows are marked by their GET/heartbeat/poll owner. Card-return callback guards are also marked: card-saved catches them and redirects to Payments, whose visible reason is `We couldn't save the card. Try again.` rather than the internal text. Tester-away card declines are caught and translated to their delayed-payment state; neutral payment-service failures can still be refusals.

Each row has **F** lifetime and **Alerts: always** as defined above unless marked as a data/poll response. The condition column is the actual code predicate, retained to make the trigger precise; names such as `c`, `t`, `p`, `u` mean session/contract, test, payment and account. Multiple lines in a wording cell are alternatives, not a combined message. Empty alternatives are omitted. `<original refusal>` is a rethrow of the already cataloged reason, not another user-facing line.

### Common wording families used by several presses

* Session/work-over reasons: `You rated this test, so your part is finished.`, `You left this test.`, `Your session on <test> ended.`, `This test was stopped at <time>. Work you sent is still reviewed.`, `This test was stopped on <date>. Work you sent is still reviewed.`, `<dev> stopped the test on <date>. Work you sent is still reviewed.`, `<dev> ended your session early on <date>. Work you sent is still reviewed.` The refused-press top banner inserts `, so your <press> didn't go through` before the first sentence's full stop and can append `You can still <allowed presses>.` The constructor index below supplies the precise stop/closed variants.
* Rating: `You already rated <person>.`, `Rating closed on <date>.`, `Rating opens once some work was sent or a call took place.`, plus the exact disabled/hidden state lines in the constructor index. These can be grey notes before a press, blue when an old enabled press is refused.
* Join checks: `This test was stopped.`, `This test closed to new testers on <date>.`, `This test isn't taking new testers any more.`, `This test is paused right now.`, `You've already joined this test.`, `You rated this test, so you can't join it again.`, `You can't join this test again.`, `<test> is full right now.`, `This test is full.`, `You blocked <dev>: unblock them in Account → Blocked people to join.`, `This test isn't taking new testers right now.`, plus the active-test-limit constructor below. Application Accept substitutes the tester's name for `You've already joined` and the tester-specific active-test limit.
* Admin `alreadyLine`: another actor says `That test was already <stopped / closed> (by <admin email / the app / its developer> at <time>).`, `That test was already paused (by <admin email> at <time>).`, `That test's pause was already lifted (by <admin email> at <time>).`, `That hold was already approved (by <admin email> at <time>).`, or `That test's locked fields were already given 3 more changes (by <admin email> at <time>).` Own actions instead say `You already <action>[ in another tab] at <time>.` The same-load variant omits `in another tab`.
* Call clashes and availability: exact dynamic `clash[0]`, `blocked[0]`, row-error and closing-reason messages come from the call constructor index below; a batch lists these same sentences separated by spaces. They are not raw provider errors.
* Payment-checking and card-decline arguments: the common payment constructor index below supplies their literal wording. `chargeError` passes its caller's card-decline sentence unchanged and hides raw Stripe error text.

### Pay / Reject, Pay more, Dispute / developer side / Decide

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Developer; `loadPiece` | `This call was cancelled, so there's nothing to pay.` | `kind === "call"; c.status === "cancelled"` | `409 / "cancelled"`; [src/lib/server/payments.ts:43](../src/lib/server/payments.ts#L43) |
| Developer; `loadPiece` | `You can pay for this call once it has started.` | `kind === "call"; c.startsAt > new Date()` | `409 / "not_yet"`; [src/lib/server/payments.ts:44](../src/lib/server/payments.ts#L44) |
| Developer; `loadPiece` | `This call is still being measured: you can pay it once its length is final.` | `kind === "call"; minutes == null` | `409 / "measuring"`; [src/lib/server/payments.ts:47](../src/lib/server/payments.ts#L47) |
| Developer; `Pay / Reject (review)` | `There's no Reject: pay any amount, $0 included (say why at $0).` | `body.action === "reject"` | `409 / "no_reject"`; [src/lib/server/payments.ts:61](../src/lib/server/payments.ts#L61) |
| Developer; `Pay / Reject (review)` | `Your account is suspended: Pay waits until it is lifted.`<br>`Pay what you owe first.` | `devNow.devSuspendedAt \|\| devNow.holdStartedAt` | `403 / devNow.devSuspendedAt ? "suspended" : "held"`; [src/lib/server/payments.ts:79](../src/lib/server/payments.ts#L79) |
| Developer; `Pay / Reject (review)` | `That work doesn't exist or isn't on your test.` | `!piece \|\| piece.contract.test.developerId !== dev.id` | `404 / "not_found"`; [src/lib/server/payments.ts:83](../src/lib/server/payments.ts#L83) |
| Developer; `Pay / Reject (review)` | `<person> deleted their account before setting up payouts, so this can't be paid.` | `!testerPayable(c.tester) && !(await tx.review.findFirst({ where: piece.where }))` | `409 / "gone"`; [src/lib/server/payments.ts:89](../src/lib/server/payments.ts#L89) |
| Developer; `Pay / Reject (review)` | `<person> already charged $X for this.` | `already; chargedByTester(already.reason)` | `409 / "reviewed"`; [src/lib/server/payments.ts:95](../src/lib/server/payments.ts#L95) |
| Developer; `Pay / Reject (review)` | `<person> let this go: nothing was charged.` | `already; already.reason === LET_GO_BY_TESTER` | `409 / "reviewed"`; [src/lib/server/payments.ts:96](../src/lib/server/payments.ts#L96) |
| Developer; `Pay / Reject (review)` | `The team closed this for $0.` | `already; already.teamClosedById` | `409 / "reviewed"`; [src/lib/server/payments.ts:97](../src/lib/server/payments.ts#L97) |
| Developer; `Pay / Reject (review)` | `This $X is owed: pay it with “Pay what you owe” in Payments.` | `already; owedNow` | `409 / "owed"`; [src/lib/server/payments.ts:99](../src/lib/server/payments.ts#L99) |
| Developer; `Pay / Reject (review)` | `You already rejected this.`<br>`You already paid $X for this.` | `already` | `409 / "reviewed"`; [src/lib/server/payments.ts:100](../src/lib/server/payments.ts#L100) |
| Developer; `Pay / Reject (review)` | `Pay more closed on <date/time>.`<br>`Pay closed on <date/time>.` | `closedOut(at)` | `409 / "pay_closed"`; [src/lib/server/payments.ts:106](../src/lib/server/payments.ts#L106) |
| Developer; `Pay / Reject (review)` | `Pay what you owe first.` | `await devOwes(dev.id)` | `409 / "owed_first"`; [src/lib/server/payments.ts:108](../src/lib/server/payments.ts#L108) |
| Developer; `Pay / Reject (review)` | `Add a card in Payments first, then press Pay again.` | `card` | `409 / "no_card"`; [src/lib/server/payments.ts:126](../src/lib/server/payments.ts#L126) |
| Developer; `Pay / Reject (review)` | `We didn't hear back from the payment service, so this payment is being checked. Within 15 minutes it shows as paid, or it's back here to pay again. Don't pay it twice: it's never charged twice.` | `e instanceof HttpError && e.code === "payment_unknown"` | `502 / "payment_unknown"`; [src/lib/server/payments.ts:158](../src/lib/server/payments.ts#L158) |
| Developer; `Pay / Reject (review)` | `Your card was declined, so <tester> wasn't paid $X for the call yet. Your tests are paused until you pay what you owe: open Payments.`<br>`Your card was declined, so <tester> wasn't paid $X for the <piece.label> yet. Your tests are paused until you pay what you owe: open Payments.` | `shared check / unconditional` | `402 / "card_failed"`; [src/lib/server/payments.ts:169](../src/lib/server/payments.ts#L169) |
| Both sides / caller of shared check; `reserving` | `Payments are having a problem right now. Nothing was charged; try again shortly.` | `isTxTimeout(e)` | `503 / "payments_problem"`; [src/lib/server/payments.ts:186](../src/lib/server/payments.ts#L186) |
| Tester; `Dispute (openDispute)` | `That session doesn't exist or isn't yours.` | `!c \|\| c.testerId !== tester.id` | `404 / "not_found"`; [src/lib/server/payments.ts:229](../src/lib/server/payments.ts#L229) |
| Tester; `Dispute (openDispute)` | `The team closed this for $0, so it can't be disputed.` | `review?.teamClosedById` | `409 / "no_dispute"`; [src/lib/server/payments.ts:236](../src/lib/server/payments.ts#L236) |
| Tester; `Dispute (openDispute)` | `This hasn't been paid yet.` | `!review` | `409 / "not_paid"`; [src/lib/server/payments.ts:239](../src/lib/server/payments.ts#L239) |
| Tester; `Dispute (openDispute)` | `You settled this part yourself (Charge or Let it go), so there's no developer decision to dispute.`<br>`You already disputed this payment. A part can be disputed once.`<br>`Already paid the most this piece can be paid, so there's nothing to dispute.` | `!ok.ok` | `409 / "no_dispute"`; [src/lib/server/payments.ts:245](../src/lib/server/payments.ts#L245) |
| Admin; `Decide (decideDispute)` | `Only admins can decide disputes.` | `!isAdmin(admin)` | `403 / "not_admin"`; [src/lib/server/payments.ts:300](../src/lib/server/payments.ts#L300) |
| Admin; `Decide (decideDispute)` | `That dispute doesn't exist.` | `!d` | `404 / "not_found"`; [src/lib/server/payments.ts:302](../src/lib/server/payments.ts#L302) |
| Admin; `Decide (decideDispute)` | `<admin email> already decided this dispute at <date/time>.`<br>`<admin email> already decided this dispute.`<br>`An admin (deleted) already decided this dispute at <date/time>.`<br>`An admin (deleted) already decided this dispute.`<br>`Another admin already decided this dispute at <date/time>.`<br>`Another admin already decided this dispute.` | `d.status !== "open"` | `409 / "decided"`; [src/lib/server/payments.ts:304](../src/lib/server/payments.ts#L304) |
| Admin; `Decide (decideDispute)` | `The developer is confirming a payment for this piece with their bank. Decide again once it's confirmed or fails.` | `await (await import("./confirm")).pieceLocked({ submissionId: d.submissionId, callId: d.callId })` | `409 / "locked"`; [src/lib/server/payments.ts:313](../src/lib/server/payments.ts#L313) |
| Admin; `Decide (decideDispute)` | `<admin email> already decided this dispute at <date/time>.`<br>`<admin email> already decided this dispute.`<br>`An admin (deleted) already decided this dispute at <date/time>.`<br>`An admin (deleted) already decided this dispute.`<br>`Another admin already decided this dispute at <date/time>.`<br>`Another admin already decided this dispute.` | `claimed.count !== 1` | `409 / "decided"`; [src/lib/server/payments.ts:330](../src/lib/server/payments.ts#L330) |
| Developer; `Add your side (addDevSide)` | `That dispute doesn't exist.` | `!d \|\| !c \|\| c.testId !== testId \|\| c.test.developerId !== dev.id` | `404 / "not_found"`; [src/lib/server/payments.ts:392](../src/lib/server/payments.ts#L392) |
| Developer; `Add your side (addDevSide)` | `This dispute was already decided.` | `d.status !== "open"` | `409 / "decided"`; [src/lib/server/payments.ts:393](../src/lib/server/payments.ts#L393) |
| Developer; `Add your side (addDevSide)` | `You already sent your side.` | `!ok.ok` | `ok.message.startsWith("You already") ? 409 : 400 / "dev_side"`; [src/lib/server/payments.ts:397](../src/lib/server/payments.ts#L397) |
| Developer; `Pay more (payExtra)` | `Choose a tester.` | `!c \|\| c.testId !== testId \|\| c.test.developerId !== dev.id` | `404 / "not_found"`; [src/lib/server/payments.ts:475](../src/lib/server/payments.ts#L475) |
| Developer; `Pay more (payExtra)` | `Choose a part they sent.` | `!piece \|\| piece.contractId !== c.id` | `404 / "not_found"`; [src/lib/server/payments.ts:478](../src/lib/server/payments.ts#L478) |
| Developer; `Pay more (payExtra)` | `Extra pay goes on a call that took place.` | `piece.kind === "call" && ("status" in piece && (piece.status === "cancelled" \|\| (piece.startsAt && piece.startsAt > new Date())))` | `409 / "not_held"`; [src/lib/server/payments.ts:479](../src/lib/server/payments.ts#L479) |
| Developer; `Pay more (payExtra)` | `Pay this part first: Pay more is for a part you've already paid.` | `!paidReview \|\| paidReview.rejected` | `409 / "not_paid"`; [src/lib/server/payments.ts:482](../src/lib/server/payments.ts#L482) |
| Developer; `Pay more (payExtra)` | `The team closed this for $0.` | `paidReview.teamClosedById` | `409 / "team_closed"`; [src/lib/server/payments.ts:484](../src/lib/server/payments.ts#L484) |
| Developer; `Pay more (payExtra)` | `Pay more closed on <date/time>.`<br>`Pay closed on <date/time>.` | `closedOut(at)` | `409 / "pay_more_closed"`; [src/lib/server/payments.ts:488](../src/lib/server/payments.ts#L488) |
| Developer; `Pay more (payExtra)` | `Your account is suspended: extra pay waits until it is lifted.` | `devNow.devSuspendedAt` | `403 / "suspended"`; [src/lib/server/payments.ts:492](../src/lib/server/payments.ts#L492) |
| Developer; `Pay more (payExtra)` | `This payment isn't available.` | `(await blockedEitherWay(dev.id, c.testerId)) \|\| !testerPayable(c.tester)` | `409 / "unavailable"`; [src/lib/server/payments.ts:494](../src/lib/server/payments.ts#L494) |
| Developer; `Pay more (payExtra)` | `Add a card in Payments first, then press Pay again.` | `card` | `409 / "no_card"`; [src/lib/server/payments.ts:502](../src/lib/server/payments.ts#L502) |
| Developer; `Pay more (payExtra)` | `We didn't hear back from the payment service, so this payment is being checked. Within 15 minutes it shows as paid, or it's back here to pay again. Don't pay it twice: it's never charged twice.` | `e instanceof HttpError && e.code === "payment_unknown"` | `502 / "payment_unknown"`; [src/lib/server/payments.ts:544](../src/lib/server/payments.ts#L544) |
| Developer; `Pay more (payExtra)` | `Your card was declined, so <person> wasn't paid $X extra yet. Your tests are paused until you pay what you owe: open Payments.` | `shared check / unconditional` | `402 / "card_failed"`; [src/lib/server/payments.ts:553](../src/lib/server/payments.ts#L553) |

### Confirm with your bank

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `Bank confirmation checks (startable)` | `There's nothing to confirm here.` | `!p \|\| p.developerId !== devId` | `404 / "not_found"`; [src/lib/server/confirm.ts:190](../src/lib/server/confirm.ts#L190) |
| Both sides / caller of shared check; `Bank confirmation checks (startable)` | `You already confirmed this payment.` | `!p.actionPi; p.status === "charged" \|\| p.status === "not_set_up"` | `409 / "confirmed"`; [src/lib/server/confirm.ts:192](../src/lib/server/confirm.ts#L192) |
| Both sides / caller of shared check; `Bank confirmation checks (startable)` | `This payment was cancelled: nothing was charged.` | `!p.actionPi; p.status === "cancelled"` | `409 / "cancelled"`; [src/lib/server/confirm.ts:193](../src/lib/server/confirm.ts#L193) |
| Both sides / caller of shared check; `Bank confirmation checks (startable)` | `This confirmation expired: nothing was charged.` | `!p.actionPi` | `409 / "expired"`; [src/lib/server/confirm.ts:194](../src/lib/server/confirm.ts#L194) |
| Both sides / caller of shared check; `Bank confirmation checks (startable)` | `This confirmation expired: nothing was charged.` | `p.actionBy && p.actionBy <= new Date()` | `409 / "expired"`; [src/lib/server/confirm.ts:198](../src/lib/server/confirm.ts#L198) |
| Both sides / caller of shared check; `Bank confirmation access (own)` | `There's nothing to confirm here.` | `!p \|\| p.developerId !== devId \|\| !p.actionPi` | `404 / "not_found"`; [src/lib/server/confirm.ts:205](../src/lib/server/confirm.ts#L205) |
| Both sides / caller of shared check; `Confirm with your bank (confirmStart)` | `Your card was declined, so nothing was charged. Change your card and confirm again by <date/time>.`<br>`Your bank didn't confirm the payment, so nothing was charged.` | `(pi.status === "requires_payment_method" \|\| pi.status === "requires_confirmation" \|\| sdkOnly) && u.stripePaymentMethodId && typeof stripe.paymentIntents.confirm === "function"` | `402 / "not_confirmed"`; [src/lib/server/confirm.ts:246](../src/lib/server/confirm.ts#L246) |
| Both sides / caller of shared check; `Finish bank confirmation (confirmFinish)` | `Your bank didn't confirm the payment, so nothing was charged.` | `!ok` | `402 / "not_confirmed"`; [src/lib/server/confirm.ts:269](../src/lib/server/confirm.ts#L269) |

### Charge / Let it go, Pay what you owe, payment-hold approval

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Developer; `devHoldRefusal` | `Pay what you owe first.` | `what === "pay"` | `409 / "on_hold"`; [src/lib/server/holds.ts:45](../src/lib/server/holds.ts#L45) |
| Developer; `devHoldRefusal` | `Pay what you owe first. New tests can't be posted while payments are on hold.` | `what === "post"` | `409 / "on_hold"`; [src/lib/server/holds.ts:46](../src/lib/server/holds.ts#L46) |
| Developer; `devHoldRefusal` | `Pay what you owe first. Your tests are paused until then.` | `shared check / unconditional` | `409 / "on_hold"`; [src/lib/server/holds.ts:47](../src/lib/server/holds.ts#L47) |
| Tester; `testerHoldRefusal` | `This test is paused right now.` | `await onHold(devId)` | `409 / "paused"`; [src/lib/server/holds.ts:52](../src/lib/server/holds.ts#L52) |
| Admin; `approveHoldLift` | `You already approved this lift in another tab at <date/time>.`<br>`You already approved this lift at <date/time>.` | `!dev?.holdStartedAt \|\| dev.holdReason === "chargeback" \|\| dev.holdCount <= HOLD_APPROVAL_AFTER; ok && (!hold \|\| hold.createdAt <= ok.createdAt); own` | `409 / "decided"`; [src/lib/server/holds.ts:302](../src/lib/server/holds.ts#L302) |
| Admin; `approveHoldLift` | `This lift was already approved by <person> at <date/time>.`<br>`This lift was already approved at <date/time>.` | `!dev?.holdStartedAt \|\| dev.holdReason === "chargeback" \|\| dev.holdCount <= HOLD_APPROVAL_AFTER; ok && (!hold \|\| hold.createdAt <= ok.createdAt)` | `409 / "decided"`; [src/lib/server/holds.ts:304](../src/lib/server/holds.ts#L304) |
| Admin; `approveHoldLift` | `That account's hold doesn't need an approval.` | `!dev?.holdStartedAt \|\| dev.holdReason === "chargeback" \|\| dev.holdCount <= HOLD_APPROVAL_AFTER` | `409 / "not_needed"`; [src/lib/server/holds.ts:306](../src/lib/server/holds.ts#L306) |
| Admin; `approveHoldLift / already` | `You already approved this lift in another tab at <date/time>.`<br>`You already approved this lift at <date/time>.` | `own && now.holdApprovedAt` | `409 / "decided"`; [src/lib/server/holds.ts:312](../src/lib/server/holds.ts#L312) |
| Admin; `approveHoldLift / already` | `This lift was already approved by <person> at <date/time>.`<br>`This lift was already approved by <person>.`<br>`This lift was already approved at <date/time>.`<br>`This lift was already approved.` | `shared check / unconditional` | `409 / "decided"`; [src/lib/server/holds.ts:314](../src/lib/server/holds.ts#L314) |
| Developer; `Pay what you owe (payOwed)` | `Reserved $X: it's taken when the team approves lifting your hold.` | `rs && rs.reservedCents > 0 && list.length` | `409 / "nothing_owed"`; [src/lib/server/holds.ts:344](../src/lib/server/holds.ts#L344) |
| Developer; `Pay what you owe (payOwed)` | `There's nothing more to reserve: what you owe is already reserved on your card.` | `!list.length; covered?.size` | `409 / "nothing_owed"`; [src/lib/server/holds.ts:349](../src/lib/server/holds.ts#L349) |
| Developer; `Pay what you owe (payOwed)` | `There's nothing to pay: what you owed is already paid.` | `!list.length` | `409 / "nothing_owed"`; [src/lib/server/holds.ts:350](../src/lib/server/holds.ts#L350) |
| Developer; `Pay what you owe (payOwed)` | `Verify your card first.` | `u.holdStartedAt && u.holdReason === "chargeback" && !u.chargebackCardVerifiedAt` | `409 / "verify_first"`; [src/lib/server/holds.ts:353](../src/lib/server/holds.ts#L353) |
| Tester; `Charge / Let it go (chooseOutcome)` | `That work doesn't exist.` | `!s \|\| s.contractId !== contractId \|\| s.contract.testerId !== tester.id` | `404 / "not_found"`; [src/lib/server/holds.ts:1186](../src/lib/server/holds.ts#L1186) |
| Tester; `Charge / Let it go (chooseOutcome)` | `A payment for this is being confirmed right now.` | `await (await import("./confirm")).pieceLocked({ submissionId: s.id })` | `409 / "locked"`; [src/lib/server/holds.ts:1189](../src/lib/server/holds.ts#L1189) |
| Tester; `Charge / Let it go (chooseOutcome)` | `You already chose for this.` | `s.review; byTesterChoice(s.review.reason)` | `409 / "done"`; [src/lib/server/holds.ts:1191](../src/lib/server/holds.ts#L1191) |
| Tester; `Charge / Let it go (chooseOutcome)` | `<person> rejected this meanwhile.`<br>`<person> paid $X for this meanwhile.` | `s.review` | `409 / "done"`; [src/lib/server/holds.ts:1192](../src/lib/server/holds.ts#L1192) |
| Tester; `Charge / Let it go (chooseOutcome)` | `You can't charge for work sent after your deadline.` | `s.late` | `409 / "late"`; [src/lib/server/holds.ts:1197](../src/lib/server/holds.ts#L1197) |
| Tester; `Charge / Let it go (chooseOutcome)` | `You can choose once 7 days have passed since you sent it and your deadline has passed.` | `!s.choiceOfferedAt` | `409 / "not_yet"`; [src/lib/server/holds.ts:1198](../src/lib/server/holds.ts#L1198) |
| Tester; `Charge / Let it go (chooseOutcome)` | `This part is already paid in full.` | `cap === 0` | `409 / "paid_in_full"`; [src/lib/server/holds.ts:1205](../src/lib/server/holds.ts#L1205) |
| Tester; `Charge / Let it go (chooseOutcome)` | `This was already settled.` | `!review` | `409 / "done"`; [src/lib/server/holds.ts:1216](../src/lib/server/holds.ts#L1216) |
| Tester; `Charge / Let it go (chooseOutcome)` | `We didn't hear back from the payment service, so this payment is being checked. Within 15 minutes it shows as paid, or it's back here to pay again. Don't pay it twice: it's never charged twice.` | `e instanceof HttpError && e.code === "payment_unknown"` | `502 / "payment_unknown"`; [src/lib/server/holds.ts:1245](../src/lib/server/holds.ts#L1245) |
| Tester; `Charge / Let it go (chooseOutcome)` | `Payments are having a problem right now. Nothing was charged; try again shortly.` | `!(e instanceof HttpError && e.code === "card_failed"); e instanceof HttpError` | `503 / "payments_problem"`; [src/lib/server/holds.ts:1250](../src/lib/server/holds.ts#L1250) |
| Tester; `Charge / Let it go close-out check (chargeCloseOutGate)` | `Charge and Let it go closed on <date/time>.` | `closedOut(at)` | `409 / "charge_closed"`; [src/lib/server/holds.ts:1265](../src/lib/server/holds.ts#L1265) |
| Tester; `Charge / Let it go (older call page) (chooseCallOutcome)` | `That call doesn't exist.` | `!x \|\| x.contractId !== contractId \|\| x.contract.testerId !== tester.id` | `404 / "not_found"`; [src/lib/server/holds.ts:1271](../src/lib/server/holds.ts#L1271) |
| Tester; `Charge / Let it go (older call page) (chooseCallOutcome)` | `A payment for this is being confirmed right now.` | `await (await import("./confirm")).pieceLocked({ callId: x.id })` | `409 / "locked"`; [src/lib/server/holds.ts:1273](../src/lib/server/holds.ts#L1273) |
| Tester; `Charge / Let it go (older call page) (chooseCallOutcome)` | `You already chose for this.` | `x.review; byTesterChoice(x.review.reason)` | `409 / "done"`; [src/lib/server/holds.ts:1275](../src/lib/server/holds.ts#L1275) |
| Tester; `Charge / Let it go (older call page) (chooseCallOutcome)` | `<person> paid $X for this meanwhile.` | `x.review` | `409 / "done"`; [src/lib/server/holds.ts:1276](../src/lib/server/holds.ts#L1276) |
| Tester; `Charge / Let it go (older call page) (chooseCallOutcome)` | `This call is charged automatically, so there's nothing to choose.` | `x.rateCents != null` | `409 / "auto_charge"`; [src/lib/server/holds.ts:1279](../src/lib/server/holds.ts#L1279) |
| Tester; `Charge / Let it go (older call page) (chooseCallOutcome)` | `You can choose once 7 days have passed since the call and your deadline has passed.` | `!x.choiceOfferedAt` | `409 / "not_yet"`; [src/lib/server/holds.ts:1282](../src/lib/server/holds.ts#L1282) |
| Tester; `Charge / Let it go (older call page) (chooseCallOutcome)` | `There's nothing left to charge for this call (the $1,000 for calls on this test is used).` | `cap === 0 && choice === "charge"` | `409 / "paid_in_full"`; [src/lib/server/holds.ts:1287](../src/lib/server/holds.ts#L1287) |
| Tester; `Charge / Let it go (older call page) (chooseCallOutcome)` | `This was already settled.` | `!review` | `409 / "done"`; [src/lib/server/holds.ts:1298](../src/lib/server/holds.ts#L1298) |
| Tester; `Charge / Let it go (older call page) (chooseCallOutcome)` | `We didn't hear back from the payment service, so this payment is being checked. Within 15 minutes it shows as paid, or it's back here to pay again. Don't pay it twice: it's never charged twice.` | `e instanceof HttpError && e.code === "payment_unknown"` | `502 / "payment_unknown"`; [src/lib/server/holds.ts:1323](../src/lib/server/holds.ts#L1323) |
| Tester; `Charge / Let it go (older call page) (chooseCallOutcome)` | `Payments are having a problem right now. Nothing was charged; try again shortly.` | `!(e instanceof HttpError && e.code === "card_failed"); e instanceof HttpError` | `503 / "payments_problem"`; [src/lib/server/holds.ts:1327](../src/lib/server/holds.ts#L1327) |

### Rate

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `Rate (refuse)` | `<already-rated line; common families below>` | `s.kind === "rated"` | `409 / "rated"`; [src/lib/server/ratings.ts:222](../src/lib/server/ratings.ts#L222) |
| Both sides / caller of shared check; `Rate (refuse)` | `<Rate refusal; common families below>` | `shared check / unconditional` | `409 / s.line === RATE_INACTIVE ? "inactive" : "not_yet"`; [src/lib/server/ratings.ts:223](../src/lib/server/ratings.ts#L223) |
| Developer; `Rate tester (devRate)` | `Choose a tester.` | `!c0 \|\| c0.testId !== testId` | `404 / "not_found"`; [src/lib/server/ratings.ts:260](../src/lib/server/ratings.ts#L260) |

### Join, Apply, Withdraw, application / rejoin Accept or Decline

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `closedInvite` | `This invite is no longer open.`<br>`This test was stopped.`<br>`“<test>” closed to new testers on <date/time>.`<br>`“<test>” isn't taking new testers right now, so this invite was closed.` | `shared check / unconditional` | `409 / "invite_closed"`; [src/lib/server/joining.ts:154](../src/lib/server/joining.ts#L154) |
| Both sides / caller of shared check; `replacedInvite` | `<person> changed the listing at <date/time> and sent you a new invite on it. Press Join to join on it.`<br>`<person> changed the listing at <date/time>, and this invite closed.` | `shared check / unconditional` | `409 / "invite_replaced"`; [src/lib/server/joining.ts:173](../src/lib/server/joining.ts#L173) |
| Both sides / caller of shared check; `alreadyWaiting` | `You already asked to rejoin this test in another tab.`<br>`You already applied to join this test in another tab.` | `shared check / unconditional` | `409 / "already_waiting"`; [src/lib/server/joining.ts:183](../src/lib/server/joining.ts#L183) |
| Both sides / caller of shared check; `inviteBeforePress` | `<dev> invited you: press Join to join.` | `seen && inv.createdAt <= seen` | `409 / "invited"`; [src/lib/server/joining.ts:202](../src/lib/server/joining.ts#L202) |
| Tester; `Join (join)` | `Turn on “test apps, games and more” in your profile to join tests.` | `!tester.isTester` | `403 / "not_tester"`; [src/lib/server/joining.ts:208](../src/lib/server/joining.ts#L208) |
| Tester; `Join (join)` | `That test doesn't exist.` | `!t` | `404 / "not_found"`; [src/lib/server/joining.ts:210](../src/lib/server/joining.ts#L210) |
| Tester; `Join (join)` | `This test was stopped.`<br>`This test closed to new testers on <date/time>.`<br>`This test isn't taking new testers any more.`<br>`This test is paused right now.`<br>`You've already joined this test.`<br>`You rated this test, so you can't join it again.`<br>`You can't join this test again.`<br>`<test> is full right now.`<br>`This test is full.`<br>`You blocked <person>: unblock them in Account → Blocked people to join.`<br>`This test isn't taking new testers right now.`<br>`You can't join more tests right now.` | `refusal` | `409 / "refused"`; [src/lib/server/joining.ts:213](../src/lib/server/joining.ts#L213) |
| Tester; `Join (join)` | `You left this test, so you ask to rejoin and the developer accepts.` | `gone && gone.status !== "working" && body.rejoinAccepted !== true && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } }))` | `409 / "ask"`; [src/lib/server/joining.ts:217](../src/lib/server/joining.ts#L217) |
| Tester; `Join (join)` | `This test takes applications: press Apply to join.` | `t.joinMode === "apply" && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } })) && !(await db.application.findFirst({ where: { testId, testerId: tester.id, status: "pending", changedAt: { not: null } } }))` | `409 / "apply"`; [src/lib/server/joining.ts:222](../src/lib/server/joining.ts#L222) |
| Tester; `Join (join)` | `This test is invite only.` | `t.joinMode === "invite" && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } }))` | `409 / "invite_only"`; [src/lib/server/joining.ts:224](../src/lib/server/joining.ts#L224) |
| Tester; `Apply to join (apply)` | `Turn on “test apps, games and more” in your profile to join tests.` | `!tester.isTester` | `403 / "not_tester"`; [src/lib/server/joining.ts:232](../src/lib/server/joining.ts#L232) |
| Tester; `Apply to join (apply)` | `That test doesn't exist.` | `!t` | `404 / "not_found"`; [src/lib/server/joining.ts:234](../src/lib/server/joining.ts#L234) |
| Tester; `Apply to join (apply)` | `This test was stopped.`<br>`This test closed to new testers on <date/time>.`<br>`This test isn't taking new testers any more.`<br>`This test is paused right now.`<br>`You've already joined this test.`<br>`You rated this test, so you can't join it again.`<br>`You can't join this test again.`<br>`<test> is full right now.`<br>`This test is full.`<br>`You blocked <person>: unblock them in Account → Blocked people to join.`<br>`This test isn't taking new testers right now.`<br>`You can't join more tests right now.` | `refusal` | `409 / "refused"`; [src/lib/server/joining.ts:237](../src/lib/server/joining.ts#L237) |
| Tester; `Apply to join (apply)` | `This test is invite only.` | `t.joinMode === "invite"` | `409 / "invite_only"`; [src/lib/server/joining.ts:245](../src/lib/server/joining.ts#L245) |
| Tester; `Withdraw application (withdrawApplication)` | `There's no pending application to withdraw.`<br>`<person> accepted your application at <date/time>, so you're in this test.`<br>`The developer accepted your application at <date/time>, so you're in this test.`<br>`<person> declined your application at <date/time>.`<br>`The developer declined your application at <date/time>.`<br>`You withdrew it in another tab at <date/time>.`<br>`It closed when <person> changed the listing at <date/time>. You can apply again.`<br>`It closed when The developer changed the listing at <date/time>. You can apply again.` | `!n.count` | `409 / "gone"`; [src/lib/server/joining.ts:264](../src/lib/server/joining.ts#L264) |
| Developer; `Accept / Decline application or rejoin ask (decideApplication)` | `That application doesn't exist.` | `!a \|\| a.testId !== testId` | `404 / "not_found"`; [src/lib/server/joining.ts:296](../src/lib/server/joining.ts#L296) |
| Developer; `Accept / Decline application or rejoin ask (decideApplication)` | `<person>'s application closed when the test filled up at <date/time>.` | `a.status === "closed" && a.closedReason === "full"` | `409 / "gone"`; [src/lib/server/joining.ts:299](../src/lib/server/joining.ts#L299) |
| Developer; `Accept / Decline application or rejoin ask (decideApplication)` | `<person>'s application was closed.` | `a.status === "closed" && a.closedReason === "blocked"` | `409 / "gone"`; [src/lib/server/joining.ts:301](../src/lib/server/joining.ts#L301) |
| Developer; `Accept / Decline application or rejoin ask (decideApplication)` | `<person>'s application closed when the test became invite only at <date/time>.`<br>`<person>'s application closed when you changed the listing in another tab at <date/time>.` | `a.status === "closed"` | `409 / "gone"`; [src/lib/server/joining.ts:302](../src/lib/server/joining.ts#L302) |
| Developer; `Accept / Decline application or rejoin ask (decideApplication)` | `<person> withdrew their application.`<br>`You already declined this application.`<br>`You already accepted this application.`<br>`This application was already answered.` | `a.status !== "pending"` | `409 / "gone"`; [src/lib/server/joining.ts:304](../src/lib/server/joining.ts#L304) |
| Developer; `Accept / Decline application or rejoin ask (decideApplication)` | `This test was stopped.`<br>`This test closed to new testers on <date/time>.`<br>`This test isn't taking new testers any more.`<br>`This test is paused right now.`<br>`<person> already joined this test.`<br>`You rated this test, so you can't join it again.`<br>`You can't join this test again.`<br>`<test> is full right now.`<br>`This test is full.`<br>`You blocked <person>: unblock them in Account → Blocked people to join.`<br>`This test isn't taking new testers right now.`<br>`You can't join more tests right now.` | `refusal` | `409 / "refused"`; [src/lib/server/joining.ts:333](../src/lib/server/joining.ts#L333) |
| Tester; `Ask to rejoin (askToRejoin)` | `Turn on “test apps, games and more” in your profile to join tests.` | `!tester.isTester` | `403 / "not_tester"`; [src/lib/server/joining.ts:420](../src/lib/server/joining.ts#L420) |
| Tester; `Ask to rejoin (askToRejoin)` | `That test doesn't exist.` | `!t` | `404 / "not_found"`; [src/lib/server/joining.ts:422](../src/lib/server/joining.ts#L422) |
| Tester; `Ask to rejoin (askToRejoin)` | `You've already joined this test.`<br>`You haven't been in this test.` | `!old \|\| old.status === "working"` | `409 / "not_again"`; [src/lib/server/joining.ts:425](../src/lib/server/joining.ts#L425) |
| Tester; `Ask to rejoin (askToRejoin)` | `This test isn't taking new testers right now.` | `await blocks.blockedEitherWay(tester.id, t.developerId)` | `409 / "refused"`; [src/lib/server/joining.ts:428](../src/lib/server/joining.ts#L428) |
| Tester; `Ask to rejoin (askToRejoin)` | `You rated this test, so you can't join it again.`<br>`You can't ask to rejoin this test.` | `!canAskToRejoin(old, rated)` | `409 / "not_again"`; [src/lib/server/joining.ts:429](../src/lib/server/joining.ts#L429) |
| Tester; `Ask to rejoin (askToRejoin)` | `This test was stopped.`<br>`This test closed to new testers on <date/time>.`<br>`This test isn't taking new testers any more.`<br>`This test is paused right now.`<br>`You've already joined this test.`<br>`You rated this test, so you can't join it again.`<br>`You can't join this test again.`<br>`<test> is full right now.`<br>`This test is full.`<br>`You blocked <person>: unblock them in Account → Blocked people to join.`<br>`This test isn't taking new testers right now.`<br>`You can't join more tests right now.` | `refusal` | `409 / "refused"`; [src/lib/server/joining.ts:431](../src/lib/server/joining.ts#L431) |

### Invite / Invite anyway / Cancel invite

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Developer; `Invite / Invite anyway (inviteTesters)` | `This test was stopped on <date/time>, so nobody can be invited.`<br>`This test was stopped, so nobody can be invited.`<br>`Joining closed on <date/time> (Open until), so nobody can be invited.`<br>`This test is paused until the chargeback steps are done, so nobody can be invited.`<br>`This test is paused until you pay what you owe, so nobody can be invited.`<br>`This test isn't taking new testers, so nobody can be invited.`<br>`<test> is full. Add spots to invite more people.`<br>`This test is full. Add spots to invite more people.` | `refusal` | `409 / "refused"`; [src/lib/server/invites.ts:243](../src/lib/server/invites.ts#L243) |
| Developer; `Invite / Invite anyway (inviteTesters)` | `<items> rated this test, so they can't join it again. Untick them to invite the others.` | `rated.length` | `409 / "refused"`; [src/lib/server/invites.ts:250](../src/lib/server/invites.ts#L250) |
| Developer; `Invite / Invite anyway (inviteTesters)` | `Everyone you ticked now meets this test's needs. Press Invite to send.` | `body.anyway === true && !gaps.length` | `409 / "needs_none"`; [src/lib/server/invites.ts:304](../src/lib/server/invites.ts#L304) |
| Developer; `Invite / Invite anyway (inviteTesters)` | `CONFIRM:<items>` | `gaps.length && body.anyway !== true` | `409 / "needs_confirm"`; [src/lib/server/invites.ts:306](../src/lib/server/invites.ts#L306) |
| Developer; `Invite / Invite anyway (inviteTesters)` | `CONFIRM:<items>` | `gaps.length && JSON.stringify(seenGaps) !== JSON.stringify(gaps)` | `409 / "needs_confirm"`; [src/lib/server/invites.ts:309](../src/lib/server/invites.ts#L309) |
| Developer; `Cancel invite (cancelInvite)` | `That invite doesn't exist.` | `!inv \|\| inv.testId !== testId` | `404 / "not_found"`; [src/lib/server/invites.ts:367](../src/lib/server/invites.ts#L367) |
| Developer; `Cancel invite (cancelInvite)` | `They already joined.`<br>`This invite is no longer valid: it was re-sent on the new listing.`<br>`This invite was already cancelled.` | `inv.status !== "sent"` | `409 / "gone"`; [src/lib/server/invites.ts:380](../src/lib/server/invites.ts#L380) |

### Call requests, Accept / Decline / Withdraw, Cancel repeating calls

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `checkCeiling` | `Calls with <person> on this test can come to at most $X; $X is left, so this call can't be booked.` | `line` | `409 / "calls_ceiling"`; [src/lib/server/callMoney.ts:40](../src/lib/server/callMoney.ts#L40) |
| Both sides / caller of shared check; `ctx` | `That session doesn't exist.` | `!c \|\| !side` | `404 / "not_found"`; [src/lib/server/requests.ts:49](../src/lib/server/requests.ts#L49) |
| Both sides / caller of shared check; `sendClash` | `<otherName> already asked for <date/time> (<minutes> min). Accept <mine.otherPoss> request, or pick a time that doesn't overlap.` | `mine && r.fromSide !== mine.side` | `409 / "their_request"`; [src/lib/server/requests.ts:162](../src/lib/server/requests.ts#L162) |
| Both sides / caller of shared check; `refusals` | `Your session has ended.`<br>`<person>'s session has ended.` | `c.status !== "working"` | `409 / "closed"`; [src/lib/server/requests.ts:236](../src/lib/server/requests.ts#L236) |
| Both sides / caller of shared check; `refusals` | `This test is paused right now. You can request calls once it resumes.`<br>`Your account is suspended: your tests are paused. Contact us in Settings to appeal.`<br>`Pay what you owe first.`<br>`The team paused this test.` | `testPaused(c.test.developer, c.test)` | `409 / "paused"`; [src/lib/server/requests.ts:237](../src/lib/server/requests.ts#L237) |
| Both sides / caller of shared check; `refusals` | `This test was stopped.` | `c.test.status === "stopped"` | `409 / "closed"`; [src/lib/server/requests.ts:239](../src/lib/server/requests.ts#L239) |
| Both sides / caller of shared check; `refusals` | `This time isn't available.` | `await db.block.count({ where: { OR: [{ blockerId: c.testerId, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: c.testerId }] } })` | `409 / "gone"`; [src/lib/server/requests.ts:241](../src/lib/server/requests.ts#L241) |
| Developer; `Request a call (devRequestTime)` | `That tester isn't in this test.` | `x.side !== "developer" \|\| x.c.testId !== testId` | `404 / "not_found"`; [src/lib/server/requests.ts:285](../src/lib/server/requests.ts#L285) |
| Developer; `Request a call (devRequestTime)` | `You already requested this time with <people / items>.` | `again.length` | `409 / "already"`; [src/lib/server/requests.ts:297](../src/lib/server/requests.ts#L297) |
| Developer; `Request a call (devRequestTime)` | `<one of the call-clash sentences listed below>` | `onceStarts.length; match && hit; clash.length` | `409 / "clash"`; [src/lib/server/requests.ts:306](../src/lib/server/requests.ts#L306) |
| Developer; `Request a call (devRequestTime)` | `<person> already has 3 booked times with you. Wait until one is over or cancel one.` | `onceStarts.length; match && hit; (await bookedTimes(c.id)) >= MAX_BOOKED` | `409 / "limit"`; [src/lib/server/requests.ts:307](../src/lib/server/requests.ts#L307) |
| Developer; `Request a call (devRequestTime)` |  | `own` | `409 / "clash"`; [src/lib/server/requests.ts:319](../src/lib/server/requests.ts#L319) |
| Developer; `Request a call (devRequestTime)` | `<one of the call-clash / calls-ceiling sentences listed below>` | `all.length === 1 && blocked.length` | `409 / "clash"`; [src/lib/server/requests.ts:333](../src/lib/server/requests.ts#L333) |
| Developer; `Request a call (devRequestTime)` | `You already have 3 requests waiting with <atLimit[0]>. Withdraw one or wait for an answer.` | `all.length === 1 && atLimit.length` | `409 / "limit"`; [src/lib/server/requests.ts:334](../src/lib/server/requests.ts#L334) |
| Developer; `Request a call (devRequestTime)` | `<items>` | `!ok.length` | `409 / "limit"`; [src/lib/server/requests.ts:335](../src/lib/server/requests.ts#L335) |
| Tester; `Request a call (testerRequestTime)` | `That session doesn't exist.` | `side !== "tester"` | `404 / "not_found"`; [src/lib/server/requests.ts:360](../src/lib/server/requests.ts#L360) |
| Tester; `Request a call (testerRequestTime)` | `<one of the call-clash sentences listed below>` | `onceStarts.length; clash.length` | `409 / "clash"`; [src/lib/server/requests.ts:378](../src/lib/server/requests.ts#L378) |
| Tester; `Request a call (testerRequestTime)` | `You already have 3 booked times in this test.` | `onceStarts.length; (await bookedTimes(contractId)) >= MAX_BOOKED` | `409 / "limit"`; [src/lib/server/requests.ts:379](../src/lib/server/requests.ts#L379) |
| Tester; `Request a call (testerRequestTime)` |  | `own` | `409 / "clash"`; [src/lib/server/requests.ts:390](../src/lib/server/requests.ts#L390) |
| Tester; `Request a call (testerRequestTime)` | `You already have a call with <person> at <date/time>.`<br>`You already have a request with <person> waiting for that time (<date/time>).` | `clash` | `409 / "clash"`; [src/lib/server/requests.ts:392](../src/lib/server/requests.ts#L392) |
| Tester; `Request a call (testerRequestTime)` | `You already have 3 requests waiting with <person>. Withdraw one or wait for an answer.` | `(await pendingRequests(contractId)) >= MAX_REQUESTS` | `409 / "limit"`; [src/lib/server/requests.ts:393](../src/lib/server/requests.ts#L393) |
| Both sides / caller of shared check; `Accept / Decline / Withdraw request (answerRequest)` | `That request doesn't exist.` | `!r \|\| r.contractId !== contractId` | `404 / "not_found"`; [src/lib/server/requests.ts:417](../src/lib/server/requests.ts#L417) |
| Both sides / caller of shared check; `Accept / Decline / Withdraw request (answerRequest)` | `<closing reason>.`<br>`You already withdrew this request.`<br>`<person> withdrew this request at <date/time>.`<br>`<person> declined this request at <date/time>.`<br>`You already declined this request.`<br>`This time was booked at <date/time>.`<br>`The call time <date/time> is no longer available.`<br>`This request closed: <closing reason>.`<br>`This request closed.` | `fresh.status !== "pending"` | `409 / "gone"`; [src/lib/server/requests.ts:425](../src/lib/server/requests.ts#L425) |
| Both sides / caller of shared check; `Accept / Decline / Withdraw request (answerRequest)` | `You can't answer your own request: withdraw it instead.`<br>`Only the person who asked can withdraw it.` | `action === "withdraw" ? !mine : mine` | `409 / "not_yours"`; [src/lib/server/requests.ts:426](../src/lib/server/requests.ts#L426) |
| Both sides / caller of shared check; `Accept / Decline / Withdraw request (answerRequest)` | `These days clash: <items>`<br>`These weeks clash: <items>` | `action === "accept"; row.repeat !== "once"; bad.length` | `409 / "clash"`; [src/lib/server/requests.ts:452](../src/lib/server/requests.ts#L452) |
| Both sides / caller of shared check; `Accept / Decline / Withdraw request (answerRequest)` | `<one of the call-clash sentences listed below>` | `action === "accept"; row.repeat !== "once"; clashes.length` | `409 / "clash"`; [src/lib/server/requests.ts:455](../src/lib/server/requests.ts#L455) |
| Both sides / caller of shared check; `Accept / Decline / Withdraw request (answerRequest)` | `<person> already has 3 booked times with you. Wait until one is over or cancel one.`<br>`You already have 3 booked times in this test.` | `action === "accept"; (await bookedTimes(contractId)) >= MAX_BOOKED` | `409 / "limit"`; [src/lib/server/requests.ts:457](../src/lib/server/requests.ts#L457) |
| Both sides / caller of shared check; `Accept / Decline / Withdraw request (answerRequest)` | `At most <best.max> minutes: the $X for calls with <best.name> on this test.` | `action === "accept"; overCap` | `409 / "calls_ceiling"`; [src/lib/server/requests.ts:460](../src/lib/server/requests.ts#L460) |
| Both sides / caller of shared check; `Cancel repeating calls (cancelCallSet)` | `The remaining calls of this set were already cancelled.` | `!first.length` | `409 / "cancelled"`; [src/lib/server/requests.ts:502](../src/lib/server/requests.ts#L502) |
| Both sides / caller of shared check; `Cancel repeating calls (cancelCallSet)` | `The remaining calls of this set were already cancelled.` | `!calls.length` | `409 / "cancelled"`; [src/lib/server/requests.ts:508](../src/lib/server/requests.ts#L508) |

### Cancel call / No-show / Join call and live-room presses

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `blockUser` | `That person doesn't exist.` | `!other` | `404 / "not_found"`; [src/lib/server/blocks.ts:51](../src/lib/server/blocks.ts#L51) |
| Both sides / caller of shared check; `blockUser` | `You already blocked <person>.` | `await iBlocked(me.id, otherId)` | `409 / "already"`; [src/lib/server/blocks.ts:53](../src/lib/server/blocks.ts#L53) |
| Both sides / caller of shared check; `joinCall` | `This call is over.` | `own && (own.contract.testerId === user.id \|\| own.contract.test.developerId === user.id) && ((await callEndState(callId))?.ended \|\| own.endedAt)` | `409 / "cant_join"`; [src/lib/server/blocks.ts:112](../src/lib/server/blocks.ts#L112) |
| Both sides / caller of shared check; `joinCall` | `That call doesn't exist.` | `!call \|\| !c \|\| !side` | `404 / "not_found"`; [src/lib/server/blocks.ts:116](../src/lib/server/blocks.ts#L116) |
| Both sides / caller of shared check; `joinCall` | `Your Join call didn't go through: <refusal[0]><refusal.slice(1).`<br>`Your Join call didn't go through: you cancelled this call at <date/time>.`<br>`Your Join call didn't go through: you cancelled this call.`<br>`Your Join call didn't go through: <person> cancelled this call at <date/time>.`<br>`Your Join call didn't go through: <person> cancelled this call.`<br>`Your Join call didn't go through: cancelled this call at <date/time>.`<br>`Your Join call didn't go through: cancelled this call.`<br>`Your Join call didn't go through: this call was cancelled: <call.cancelNote>.`<br>`Your Join call didn't go through: this call was cancelled.` | `refusal` | `409 / "cant_join"`; [src/lib/server/blocks.ts:130](../src/lib/server/blocks.ts#L130) |
| Both sides / caller of shared check; `callStatus` | `That call doesn't exist.` | `!call \|\| !c \|\| (c.testerId !== user.id && c.test.developerId !== user.id)` | `404 / "not_found"`; [src/lib/server/blocks.ts:145](../src/lib/server/blocks.ts#L145) |
| Developer; `Cancel call (devCancelCall)` | `That call doesn't exist.` | `!c \|\| c.contract.testId !== testId` | `404 / "not_found"`; [src/lib/server/calls.ts:30](../src/lib/server/calls.ts#L30) |
| Developer; `Cancel call (devCancelCall)` | `The call with <person> was already cancelled.`<br>`The call with <person> was already cancelled. Refresh to see the latest.` | `c.status === "cancelled"` | `409 / "cancelled"`; [src/lib/server/calls.ts:35](../src/lib/server/calls.ts#L35) |
| Tester; `Cancel call (testerCancelCall)` | `That call doesn't exist.` | `!call \|\| call.contractId !== contractId` | `404 / "not_found"`; [src/lib/server/calls.ts:82](../src/lib/server/calls.ts#L82) |
| Tester; `Cancel call (testerCancelCall)` | `This call was already cancelled.` | `call.status === "cancelled"` | `409 / "cancelled"`; [src/lib/server/calls.ts:83](../src/lib/server/calls.ts#L83) |
| Both sides / caller of shared check; `reportNoShow` | `That call doesn't exist.` | `!call \|\| !side` | `404 / "not_found"`; [src/lib/server/calls.ts:101](../src/lib/server/calls.ts#L101) |
| Both sides / caller of shared check; `reportNoShow` | `This call was cancelled.` | `call.status !== "booked"` | `409 / "cancelled"`; [src/lib/server/calls.ts:102](../src/lib/server/calls.ts#L102) |
| Both sides / caller of shared check; `reportNoShow` | `You can report a problem once the call's time has started.` | `call.startsAt > new Date()` | `409 / "not_yet"`; [src/lib/server/calls.ts:103](../src/lib/server/calls.ts#L103) |
| Both sides / caller of shared check; `reportNoShow` | `A problem with this call was already reported.` | `call.noShowBy` | `409 / "reported"`; [src/lib/server/calls.ts:104](../src/lib/server/calls.ts#L104) |
| Both sides / caller of shared check; `refusal` | `This call isn't available.` | `!call` | `403 / "not_available"`; [src/lib/server/calls.ts:263](../src/lib/server/calls.ts#L263) |
| Both sides / caller of shared check; `refusal` | `This call isn't available.` | `shared check / unconditional` | `403 / "not_available"`; [src/lib/server/calls.ts:266](../src/lib/server/calls.ts#L266) |
| Both sides / caller of shared check; `heartbeat` | `This call isn't available.` | `!call \|\| !side` | `403 / "not_available"`; [src/lib/server/calls.ts:290](../src/lib/server/calls.ts#L290) |
| Both sides / caller of shared check; `roomPoll` | `This call isn't available.` | `!call \|\| !side` | `403 / "not_available"`; [src/lib/server/calls.ts:306](../src/lib/server/calls.ts#L306) |
| Both sides / caller of shared check; `roomSend` | `This call isn't available.` | `!call \|\| !side` | `403 / "not_available"`; [src/lib/server/calls.ts:339](../src/lib/server/calls.ts#L339) |
| Both sides / caller of shared check; `roomLeave` | `This call isn't available.` | `!call \|\| !side` | `403 / "not_available"`; [src/lib/server/calls.ts:365](../src/lib/server/calls.ts#L365) |

### Send written, Leave, Post / Save / Stop / End early / Next round

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `lockTest` | `This test was deleted.` | `!t` | `404 / "not_found"`; [src/lib/server/tests.ts:147](../src/lib/server/tests.ts#L147) |
| Developer; `ownTest` | `That test doesn't exist or isn't yours.` | `!t \|\| t.developerId !== devId` | `404 / "not_found"`; [src/lib/server/tests.ts:219](../src/lib/server/tests.ts#L219) |
| Developer; `checkPost` | `Turn on “post tests” in your profile to post a test.` | `!dev.isDeveloper` | `403 / "not_developer"`; [src/lib/server/tests.ts:244](../src/lib/server/tests.ts#L244) |
| Developer; `checkPost` | `Pay what you owe first. New tests can't be posted while payments are on hold.` | `await devOnHold(dev.id)` | `409 / "on_hold"`; [src/lib/server/tests.ts:245](../src/lib/server/tests.ts#L245) |
| Developer; `requireUniqueTitle` | `You already have a test called “<other test>” (posted <date/time>): give this one a different name.`<br>`You already have a test called “<other test>” (a draft): give this one a different name.` | `shared check / unconditional` | `409 / "same_title"`; [src/lib/server/tests.ts:278](../src/lib/server/tests.ts#L278) |
| Developer; `requireCardToPost` | `Add a card in Payments before posting: testers' pay is charged to it.` | `!user?.stripePaymentMethodId` | `402 / "card_required"`; [src/lib/server/tests.ts:285](../src/lib/server/tests.ts#L285) |
| Developer; `Post draft (postDraft)` | `This test was stopped.`<br>`This test is already open.` | `t0.status !== "draft"` | `409 / "not_draft"`; [src/lib/server/tests.ts:291](../src/lib/server/tests.ts#L291) |
| Developer; `Post draft (postDraft)` | `This test is already open.` | `t.status !== "draft"` | `409 / "not_draft"`; [src/lib/server/tests.ts:297](../src/lib/server/tests.ts#L297) |
| Developer; `Delete draft (deleteDraft)` | `Only a draft can be deleted.` | `t.status !== "draft"` | `409 / "not_draft"`; [src/lib/server/tests.ts:309](../src/lib/server/tests.ts#L309) |
| Developer; `Edit Save (editTest)` | `This test was stopped.` | `t.status === "stopped"` | `409 / "stopped"`; [src/lib/server/tests.ts:356](../src/lib/server/tests.ts#L356) |
| Developer; `Edit Save (editTest)` | `Joining closed on <date> (Open until), so it can't be extended.` | `!ou.ok` | `409 / "open_until_passed"`; [src/lib/server/tests.ts:382](../src/lib/server/tests.ts#L382) |
| Developer; `Edit Save (editTest)` | `Press Save again to save.`<br>`This test changed since you opened Edit. Press Save again to save your changes on top.` | `stop` | `409 / "changed"`; [src/lib/server/tests.ts:437](../src/lib/server/tests.ts#L437) |
| Developer; `Open draft (openDraft)` | `This test was stopped.`<br>`This test is already open.` | `t.status !== "draft"` | `409 / "not_draft"`; [src/lib/server/tests.ts:557](../src/lib/server/tests.ts#L557) |
| Developer; `Stop (stopTest)` | `This test was stopped.`<br>`This test was stopped. Refresh to see the latest.` | `t.status === "stopped"` | `409 / "stopped"`; [src/lib/server/tests.ts:720](../src/lib/server/tests.ts#L720) |
| Developer; `End early (endEarly)` | `This test was stopped.`<br>`This test was stopped. Refresh to see the latest.` | `lockedTest.status === "stopped"` | `409 / "stopped"`; [src/lib/server/tests.ts:763](../src/lib/server/tests.ts#L763) |
| Developer; `End early (endEarly)` | `Choose a tester.` | `!c \|\| c.testId !== testId` | `404 / "not_found"`; [src/lib/server/tests.ts:770](../src/lib/server/tests.ts#L770) |
| Developer; `End early (endEarly)` | `<person> already left the test.`<br>`<person> already left the test. Refresh to see the latest.` | `c.status === "left"` | `409 / "gone"`; [src/lib/server/tests.ts:772](../src/lib/server/tests.ts#L772) |
| Developer; `End early (endEarly)` | `<person>'s work already ended.`<br>`<person>'s work already ended. Refresh to see the latest.` | `c.status !== "working"` | `409 / "gone"`; [src/lib/server/tests.ts:774](../src/lib/server/tests.ts#L774) |
| Developer; `End early (endEarly)` | `<people / items>'s work already ended.` | `!list.length && endedElsewhere.length` | `409 / "gone"`; [src/lib/server/tests.ts:780](../src/lib/server/tests.ts#L780) |
| Developer; `Next round (nextRound)` | `This test already has a next round.`<br>`This test already has a next round. Refresh to see the latest.` | `existing` | `409 / "exists"`; [src/lib/server/tests.ts:814](../src/lib/server/tests.ts#L814) |
| Developer; `Next round (nextRound)` | `Pay what you owe first. Your tests are paused until then.` | `await devOnHold(dev.id)` | `409 / "on_hold"`; [src/lib/server/tests.ts:816](../src/lib/server/tests.ts#L816) |
| Developer; `Next round (goNextRound)` | `This test has no next round any more: its draft was deleted.` | `!next` | `409 / "gone"`; [src/lib/server/tests.ts:841](../src/lib/server/tests.ts#L841) |
| Both sides / caller of shared check; `gapStop` | `Your profile doesn't list a language this test needs (<items>) or a device it needs (<items>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items>) or a device it needs (<items>). <verb> anyway?`<br>`Your profile doesn't list a language this test needs (<items>) or a device it needs (<items> or <x[x.length - 1]>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items>) or a device it needs (<items> or <x[x.length - 1]>). <verb> anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items>). <verb> anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items> or <x[x.length - 1]>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items> or <x[x.length - 1]>). <verb> anyway?`<br>`Your profile doesn't list a language this test needs (<items>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items>). <verb> anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>). <verb> anyway?`<br>`Your profile doesn't list a device this test needs (<items>). Ask to rejoin anyway?`<br>`Your profile doesn't list a device this test needs (<items>). <verb> anyway?`<br>`Your profile doesn't list a device this test needs (<items> or <x[x.length - 1]>). Ask to rejoin anyway?`<br>`Your profile doesn't list a device this test needs (<items> or <x[x.length - 1]>). <verb> anyway?`<br>`Your profile . Ask to rejoin anyway?`<br>`Your profile . <verb> anyway?` | `body.anyway !== true` | `409 / "needs"`; [src/lib/server/tests.ts:894](../src/lib/server/tests.ts#L894) |
| Both sides / caller of shared check; `gapStop` | `Your profile doesn't list a language this test needs (<items>) or a device it needs (<items>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items>) or a device it needs (<items>). <verb> anyway?`<br>`Your profile doesn't list a language this test needs (<items>) or a device it needs (<items> or <x[x.length - 1]>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items>) or a device it needs (<items> or <x[x.length - 1]>). <verb> anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items>). <verb> anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items> or <x[x.length - 1]>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items> or <x[x.length - 1]>). <verb> anyway?`<br>`Your profile doesn't list a language this test needs (<items>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items>). <verb> anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>). Ask to rejoin anyway?`<br>`Your profile doesn't list a language this test needs (<items> or <x[x.length - 1]>). <verb> anyway?`<br>`Your profile doesn't list a device this test needs (<items>). Ask to rejoin anyway?`<br>`Your profile doesn't list a device this test needs (<items>). <verb> anyway?`<br>`Your profile doesn't list a device this test needs (<items> or <x[x.length - 1]>). Ask to rejoin anyway?`<br>`Your profile doesn't list a device this test needs (<items> or <x[x.length - 1]>). <verb> anyway?`<br>`Your profile . Ask to rejoin anyway?`<br>`Your profile . <verb> anyway?` | `shown && gapsUnseen(gaps, shown)` | `409 / "needs"`; [src/lib/server/tests.ts:897](../src/lib/server/tests.ts#L897) |
| Both sides / caller of shared check; `joinTest` | `Turn on “test apps, games and more” in your profile to join tests.` | `!tester.isTester` | `403 / "not_tester"`; [src/lib/server/tests.ts:907](../src/lib/server/tests.ts#L907) |
| Both sides / caller of shared check; `joinTest` | `This application is no longer waiting.` | `options.applicationId; !application \|\| application.testId !== testId \|\| application.testerId !== tester.id \|\| application.status !== "pending"` | `409 / "application_gone"`; [src/lib/server/tests.ts:915](../src/lib/server/tests.ts#L915) |
| Both sides / caller of shared check; `joinTest` | `This application is no longer waiting.` | `options.applicationId; !claimed.count` | `409 / "application_gone"`; [src/lib/server/tests.ts:917](../src/lib/server/tests.ts#L917) |
| Both sides / caller of shared check; `joinTest` | `You can't join your own test.` | `t.developerId === tester.id` | `409 / "own"`; [src/lib/server/tests.ts:919](../src/lib/server/tests.ts#L919) |
| Both sides / caller of shared check; `joinTest` | `You've already joined this test.` | `old && old.status === "working"` | `409 / "already"`; [src/lib/server/tests.ts:923](../src/lib/server/tests.ts#L923) |
| Both sides / caller of shared check; `joinTest` | `You rated this test, so you can't join it again.`<br>`You can't join this test again.` | `old && (await tx.rating.count({ where: { contractId: old.id } }))` | `409 / "not_again"`; [src/lib/server/tests.ts:925](../src/lib/server/tests.ts#L925) |
| Both sides / caller of shared check; `joinTest` | `You can't join this test again.` | `old && old.status === "ended" && body.rejoinAccepted !== true && !(await tx.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } }))` | `409 / "not_again"`; [src/lib/server/tests.ts:926](../src/lib/server/tests.ts#L926) |
| Both sides / caller of shared check; `joinTest` | `This test is paused right now.` | `testPaused(dev, t)` | `409 / "paused"`; [src/lib/server/tests.ts:928](../src/lib/server/tests.ts#L928) |
| Both sides / caller of shared check; `joinTest` | `This test was stopped.`<br>`This test closed to new testers on <date>.`<br>`This test isn't taking new testers any more.`<br>`This test is full.` | `r.result === "refused"` | `409 / "refused"`; [src/lib/server/tests.ts:931](../src/lib/server/tests.ts#L931) |
| Both sides / caller of shared check; `joinTest` | `The developer changed this test since you opened it. Check the new terms, then press Join again to join on them.` | `r.result === "changed"` | `409 / "listing_changed"`; [src/lib/server/tests.ts:933](../src/lib/server/tests.ts#L933) |
| Both sides / caller of shared check; `joinTest` | `You blocked <person>: unblock them in Account → Blocked people to join.` | `await tx.block.count({ where: { blockerId: tester.id, blockedId: t.developerId } })` | `409 / "blocked"`; [src/lib/server/tests.ts:937](../src/lib/server/tests.ts#L937) |
| Both sides / caller of shared check; `joinTest` | `This test isn't taking new testers right now.` | `await tx.block.count({ where: { blockerId: t.developerId, blockedId: tester.id } })` | `409 / "closed"`; [src/lib/server/tests.ts:938](../src/lib/server/tests.ts#L938) |
| Tester; `ownContract` | `That session doesn't exist or isn't yours.` | `!c \|\| c.testerId !== testerId` | `404 / "not_found"`; [src/lib/server/tests.ts:971](../src/lib/server/tests.ts#L971) |
| Tester; `Leave (leaveTest / refused)` | `You already left this test.`<br>`You rated this test, so your part is finished.`<br>`You left this test.`<br>`Your session on <test> ended.`<br>`Your session on this test ended.`<br>`This test was stopped at <time>. Work you sent is still reviewed.`<br>`This test was stopped on <date/time>. Work you sent is still reviewed.`<br>`<person> stopped the test on <date/time>. Work you sent is still reviewed.`<br>`This test ended on <date/time>. Work you sent is still reviewed.`<br>`<person> finished your part in <test>. Work you sent is still reviewed.`<br>`<person> finished your part in this test. Work you sent is still reviewed.`<br>`<person> ended your session early on <date/time>. Work you sent is still reviewed.`<br>`This test closed on <date/time>.` | `refusal` | `409 / "gone"`; [src/lib/server/tests.ts:988](../src/lib/server/tests.ts#L988) |
| Tester; `Send written answers (sendWritten)` | `Wait for the upload to finish before sending.` | `(await db.recording.count({ where: { contractId, part: "written", uploadedAt: null, createdAt: { gt: new Date(Date.now() - 3 * 3_600_000) } } })) \|\| JSON.stringify([body.answers, body.notes]).includes("[Uploading ")` | `409 / "uploading"`; [src/lib/server/tests.ts:1019](../src/lib/server/tests.ts#L1019) |
| Tester; `Send written answers (sendWritten)` | `This test is paused right now. You can send this once it resumes.` | `!sessionRefusal(c0, c0.test, displayName(c0.test.developer)) && testerPaused(c0.test.developer, c0.test)` | `409 / "paused"`; [src/lib/server/tests.ts:1032](../src/lib/server/tests.ts#L1032) |
| Tester; `Send written answers (sendWritten)` | `<session/work-over reason from the common family above>` | `refusal` | `409 / "closed"`; [src/lib/server/tests.ts:1039](../src/lib/server/tests.ts#L1039) |
| Tester; `Send written answers (sendWritten)` | `The team closed this for $0, so it can't be changed.`<br>`Your written answers were already reviewed, so they can't be changed.` | `locked` | `409 / "paid"`; [src/lib/server/tests.ts:1044](../src/lib/server/tests.ts#L1044) |
| Tester; `Send written answers (sendWritten)` | `Nothing has changed since you sent it.` | `existing && !replacesEarlier && items.every((x, i) => withoutTags(x.answer) === withoutTags(before[i]?.answer ?? "")) && notes === existing.notes && (await tx.recording.findMany({ where: { contractId, part: "written", uploadedAt: { not: null }, submissionId: null } })).every((f) => sentFiles.some((g) => g.filename === f.filename && g.sizeBytes === f.sizeBytes))` | `409 / "unchanged"`; [src/lib/server/tests.ts:1056](../src/lib/server/tests.ts#L1056) |

### Recording upload / Send / Remove

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Tester; `Upload recording (startRecording)` | `<session/work-over reason from the common family above>` | `refusal` | `409 / "closed"`; [src/lib/server/recordings.ts:24](../src/lib/server/recordings.ts#L24) |
| Tester; `Upload recording (startRecording)` | `The team closed this for $0, so it can't be changed.`<br>`Your written answers were already reviewed, so they can't be changed.`<br>`Your recording was already reviewed, so it can't be changed.` | `locked` | `409 / "paid"`; [src/lib/server/recordings.ts:38](../src/lib/server/recordings.ts#L38) |
| Tester; `Upload recording (startRecording)` | `You can add at most 5 recordings. Remove one first.` | `video && part === "recording" && mine.filter((r) => r.part === "recording").length >= MAX_RECORDINGS` | `409 / "too_many"`; [src/lib/server/recordings.ts:42](../src/lib/server/recordings.ts#L42) |
| Tester; `Upload recording (startRecording)` | `You can attach at most 5 recordings to your written answers.` | `video && part === "written" && mine.filter((r) => r.part === "written" && isVideo(r.contentType)).length >= MAX_RECORDINGS` | `409 / "too_many"`; [src/lib/server/recordings.ts:43](../src/lib/server/recordings.ts#L43) |
| Tester; `Upload recording (startRecording)` | `You've uploaded a lot today. Try again tomorrow.` | `today + size > DAILY_UPLOAD_BYTES` | `429 / "quota"`; [src/lib/server/recordings.ts:46](../src/lib/server/recordings.ts#L46) |
| Tester; `Upload recording (startRecording)` | `You can attach at most 5 files to your written answers.` | `!video && mine.filter((r) => r.part === "written" && !isVideo(r.contentType)).length >= MAX_ATTACHMENTS` | `409 / "too_many"`; [src/lib/server/recordings.ts:47](../src/lib/server/recordings.ts#L47) |
| Tester; `Finish upload (finishRecording)` | `That upload doesn't exist.` | `!rec \|\| rec.contractId !== contractId` | `404 / "not_found"`; [src/lib/server/recordings.ts:59](../src/lib/server/recordings.ts#L59) |
| Tester; `Finish upload (finishRecording)` | `That upload didn't finish properly. Try again.` | `r2On(); !head \|\| head.size !== rec.sizeBytes \|\| head.size > limit` | `409 / "upload_unfinished"`; [src/lib/server/recordings.ts:68](../src/lib/server/recordings.ts#L68) |
| Tester; `Remove recording (removeRecording)` | `That file was already removed.` | `body.written === true; !rec \|\| rec.contractId !== contractId \|\| rec.part !== "written"` | `404 / "not_found"`; [src/lib/server/recordings.ts:126](../src/lib/server/recordings.ts#L126) |
| Tester; `Remove recording (removeRecording)` | `That recording was already removed.` | `!rec \|\| rec.contractId !== contractId \|\| rec.part !== "recording"` | `404 / "not_found"`; [src/lib/server/recordings.ts:137](../src/lib/server/recordings.ts#L137) |
| Tester; `Remove recording (removeRecording)` | `The team closed this for $0, so it can't be changed.`<br>`Your recording was already reviewed, so it can't be changed.` | `locked` | `409 / "paid"`; [src/lib/server/recordings.ts:140](../src/lib/server/recordings.ts#L140) |
| Tester; `Send recording (sendRecording)` | `This test is paused right now. You can send this once it resumes.` | `!sessionRefusal(c0, c0.test, displayName(c0.test.developer)) && testerPaused(c0.test.developer, c0.test)` | `409 / "paused"`; [src/lib/server/recordings.ts:153](../src/lib/server/recordings.ts#L153) |
| Tester; `Send recording (sendRecording)` | `<session/work-over reason from the common family above>` | `refusal` | `409 / "closed"`; [src/lib/server/recordings.ts:164](../src/lib/server/recordings.ts#L164) |
| Tester; `Send recording (sendRecording)` | `A recording is still uploading. Send once it's done.` | `await tx.recording.count({ where: { contractId, part: "recording", uploadedAt: null, createdAt: { gt: new Date(Date.now() - UPLOADING_MS) } } })` | `409 / "uploading"`; [src/lib/server/recordings.ts:167](../src/lib/server/recordings.ts#L167) |
| Tester; `Send recording (sendRecording)` | `The team closed this for $0, so it can't be changed.`<br>`Your recording was already reviewed, so it can't be changed.` | `locked` | `409 / "paid"`; [src/lib/server/recordings.ts:171](../src/lib/server/recordings.ts#L171) |
| Tester; `Send recording (sendRecording)` | `Nothing has changed since you sent it.` | `existing && sameFiles(recs, await tx.recording.findMany({ where: { contractId, submissionId: existing.id, part: { in: ["recording", "removed"] } } }))` | `409 / "unchanged"`; [src/lib/server/recordings.ts:175](../src/lib/server/recordings.ts#L175) |
| Both sides / caller of shared check; `headObject` | `The file storage didn't answer. Try again.` | `!r.ok` | `502 / "storage"`; [src/lib/server/storage.ts:112](../src/lib/server/storage.ts#L112) |

### Switch / Keep

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `Any tester press requiring a terms answer (answerTermsFirst)` | `Answer the new terms first: Switch or Keep.` | `offer` | `409 / ANSWER_TERMS_CODE`; [src/lib/server/terms.ts:63](../src/lib/server/terms.ts#L63) |
| Both sides / caller of shared check; `Switch / Keep (decideTerms)` | `That session doesn't exist or isn't yours.` | `!c \|\| c.testerId !== tester.id` | `404 / "not_found"`; [src/lib/server/terms.ts:88](../src/lib/server/terms.ts#L88) |
| Both sides / caller of shared check; `Switch / Keep (decideTerms)` | `You already switched to these terms.` | `!newest; offer?.status === "switched"` | `409 / "gone"`; [src/lib/server/terms.ts:96](../src/lib/server/terms.ts#L96) |
| Both sides / caller of shared check; `Switch / Keep (decideTerms)` | `You already decided on these terms.` | `!newest; offer?.status === "kept"` | `409 / "gone"`; [src/lib/server/terms.ts:97](../src/lib/server/terms.ts#L97) |
| Both sides / caller of shared check; `Switch / Keep (decideTerms)` | `These terms are no longer on offer.` | `!newest` | `409 / "gone"`; [src/lib/server/terms.ts:98](../src/lib/server/terms.ts#L98) |

### Access keys

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `dismissBrokenKeys` | `That test doesn't exist.` | `!t \|\| t.developerId !== dev.id` | `404 / "not_found"`; [src/lib/server/accessKeys.ts:58](../src/lib/server/accessKeys.ts#L58) |
| Both sides / caller of shared check; `assignKeyAtJoin` | `No access key is free right now, so this test can't take another tester until the developer adds one.` | `!free` | `409 / "no_key"`; [src/lib/server/accessKeys.ts:85](../src/lib/server/accessKeys.ts#L85) |
| Tester; `reportKeyBroken` | `That session doesn't exist or isn't yours.` | `!c \|\| c.testerId !== tester.id` | `404 / "not_found"`; [src/lib/server/accessKeys.ts:130](../src/lib/server/accessKeys.ts#L130) |
| Tester; `reportKeyBroken` | `You're not working on this test any more.` | `c.status !== "working"` | `409 / "gone"`; [src/lib/server/accessKeys.ts:131](../src/lib/server/accessKeys.ts#L131) |
| Tester; `reportKeyBroken` | `You don't have an access key on this test.` | `!key` | `409 / "no_key"`; [src/lib/server/accessKeys.ts:135](../src/lib/server/accessKeys.ts#L135) |

### Admin account / test actions

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `withAccountState` | `<the original refusal, unchanged>` | `e instanceof HttpError && e.status === 409` | `e.status / e.code`; [src/lib/server/accountState.ts:70](../src/lib/server/accountState.ts#L70) |
| Admin; `stoppedRefusal` | `That test was already closed (by <admin email> at <date/time>).`<br>`That test was already stopped (by <admin email> at <date/time>).`<br>`You already closed this test in another tab at <date/time>.`<br>`You already closed this test at <date/time>.`<br>`You already stopped this test in another tab at <date/time>.`<br>`You already stopped this test at <date/time>.` | `t.adminStoppedById` | `409 / "stopped"`; [src/lib/server/adminRace.ts:194](../src/lib/server/adminRace.ts#L194) |
| Admin; `stoppedRefusal` | `That test was already closed (by <person> at <date/time>).`<br>`That test was already stopped (by <person> at <date/time>).` | `shared check / unconditional` | `409 / "stopped"`; [src/lib/server/adminRace.ts:198](../src/lib/server/adminRace.ts#L198) |
| Admin; `pausedRefusal` | `That test was already paused (by <admin email> at <date/time>).`<br>`You already paused this test in another tab at <date/time>.`<br>`You already paused this test at <date/time>.` | `shared check / unconditional` | `409 / "already"`; [src/lib/server/adminRace.ts:204](../src/lib/server/adminRace.ts#L204) |
| Admin; `liftRefusal` | `That test's pause was already lifted (by <admin email> at <date/time>).`<br>`You already lifted the pause on this test in another tab at <date/time>.`<br>`You already lifted the pause on this test at <date/time>.` | `last` | `409 / "pause_lifted"`; [src/lib/server/adminRace.ts:216](../src/lib/server/adminRace.ts#L216) |
| Admin; `liftRefusal` | `That test isn't paused by the team: it's paused by the developer's account state.` | `t.developer.holdStartedAt \|\| t.developer.devSuspendedAt` | `409 / "pause_lifted"`; [src/lib/server/adminRace.ts:217](../src/lib/server/adminRace.ts#L217) |
| Admin; `liftRefusal` | `That test isn't paused.` | `shared check / unconditional` | `409 / "pause_lifted"`; [src/lib/server/adminRace.ts:218](../src/lib/server/adminRace.ts#L218) |
| Admin; `approveGap` | `An outage is already recorded from that time.` | `shared check / unconditional` | `409 / "done"`; [src/lib/server/outages.ts:151](../src/lib/server/outages.ts#L151) |
| Admin; `gapDone` | `That possible outage was already approved or dismissed.` | `!last` | `409 / "done"`; [src/lib/server/outages.ts:171](../src/lib/server/outages.ts#L171) |
| Admin; `gapDone` | `That possible outage was already approved (by <admin email> at <date/time>).`<br>`That possible outage was already dismissed (by <admin email> at <date/time>).`<br>`You already approved this possible outage in another tab at <date/time>.`<br>`You already approved this possible outage at <date/time>.`<br>`You already dismissed this possible outage in another tab at <date/time>.`<br>`You already dismissed this possible outage at <date/time>.` | `shared check / unconditional` | `409 / "done"`; [src/lib/server/outages.ts:173](../src/lib/server/outages.ts#L173) |
| Both sides / caller of shared check; `closePausedTest` | `That test doesn't exist.` | `!t` | `404 / "not_found"`; [src/lib/server/pauseClosure.ts:21](../src/lib/server/pauseClosure.ts#L21) |
| Both sides / caller of shared check; `closePausedTest` | `That test was already stopped.` | `t.status === "stopped"` | `409 / "stopped"`; [src/lib/server/pauseClosure.ts:23](../src/lib/server/pauseClosure.ts#L23) |
| Both sides / caller of shared check; `closePausedTest` | `That test isn't paused.` | `!info` | `409 / "not_paused"`; [src/lib/server/pauseClosure.ts:24](../src/lib/server/pauseClosure.ts#L24) |
| Admin; `adminClosePaused` | `That test doesn't exist.` | `!t` | `404 / "not_found"`; [src/lib/server/pauseClosure.ts:56](../src/lib/server/pauseClosure.ts#L56) |
| Admin; `adminClosePaused` | `That test isn't paused.` | `!pauseClosesAt(t.developer, t); seen` | `409 / "not_paused"`; [src/lib/server/pauseClosure.ts:59](../src/lib/server/pauseClosure.ts#L59) |
| Admin; `extendPauseClosure` | `That test doesn't exist.` | `!t` | `404 / "not_found"`; [src/lib/server/pauseClosure.ts:91](../src/lib/server/pauseClosure.ts#L91) |
| Admin; `extendPauseClosure` | `That test isn't paused.` | `!info; seen` | `409 / "not_paused"`; [src/lib/server/pauseClosure.ts:96](../src/lib/server/pauseClosure.ts#L96) |
| Admin; `refuseDeleted` | `That account was deleted.` | `!seen \|\| u.deletedAt <= seen.since` | `409 / "deleted"`; [src/lib/server/restrictions.ts:127](../src/lib/server/restrictions.ts#L127) |
| Admin; `refuseDeleted` | `That account was deleted. its owner deleted it at <date/time>.`<br>`That account was deleted. an admin deleted it at <date/time>.`<br>`That account was deleted. an admin (deleted) deleted it at <date/time>.`<br>`That account was deleted. <email> deleted it at <date/time>.`<br>`That account was deleted. <s.charAt(0)><s.slice(1)> deleted it at <date/time>.` | `shared check / unconditional` | `409 / "deleted"`; [src/lib/server/restrictions.ts:129](../src/lib/server/restrictions.ts#L129) |
| Admin; `refuseIfChangedSince` | `Since your Preview, the team suspended that account's developer side at <date/time>.`<br>`Since your Preview, the team suspended that account's tester side at <date/time>.`<br>`Since your Preview, an admin (deleted) suspended that account's developer side at <date/time>.`<br>`Since your Preview, an admin (deleted) suspended that account's tester side at <date/time>.`<br>`Since your Preview, <email> suspended that account's developer side at <date/time>.`<br>`Since your Preview, <email> suspended that account's tester side at <date/time>.`<br>`Since this page loaded, the team suspended that account's developer side at <date/time>.`<br>`Since this page loaded, the team suspended that account's tester side at <date/time>.`<br>`Since this page loaded, an admin (deleted) suspended that account's developer side at <date/time>.`<br>`Since this page loaded, an admin (deleted) suspended that account's tester side at <date/time>.`<br>`Since this page loaded, <email> suspended that account's developer side at <date/time>.`<br>`Since this page loaded, <email> suspended that account's tester side at <date/time>.` | `suspendedAt && suspendedAt > seen.since; !own` | `409 / "changed_since"`; [src/lib/server/restrictions.ts:150](../src/lib/server/restrictions.ts#L150) |
| Admin; `refuseIfChangedSince` | `Since your Preview, you suspended that account's developer side in another tab at <date/time>.`<br>`Since your Preview, you suspended that account's tester side in another tab at <date/time>.`<br>`Since this page loaded, you suspended that account's developer side in another tab at <date/time>.`<br>`Since this page loaded, you suspended that account's tester side in another tab at <date/time>.` | `suspendedAt && suspendedAt > seen.since; own === "other" && pressing === "reinstate"` | `409 / "changed_since"`; [src/lib/server/restrictions.ts:151](../src/lib/server/restrictions.ts#L151) |
| Admin; `refuseIfChangedSince` | `Since your Preview, the team reinstated that account's developer side at <date/time>.`<br>`Since your Preview, the team reinstated that account's tester side at <date/time>.`<br>`Since your Preview, an admin (deleted) reinstated that account's developer side at <date/time>.`<br>`Since your Preview, an admin (deleted) reinstated that account's tester side at <date/time>.`<br>`Since your Preview, <email> reinstated that account's developer side at <date/time>.`<br>`Since your Preview, <email> reinstated that account's tester side at <date/time>.`<br>`Since this page loaded, the team reinstated that account's developer side at <date/time>.`<br>`Since this page loaded, the team reinstated that account's tester side at <date/time>.`<br>`Since this page loaded, an admin (deleted) reinstated that account's developer side at <date/time>.`<br>`Since this page loaded, an admin (deleted) reinstated that account's tester side at <date/time>.`<br>`Since this page loaded, <email> reinstated that account's developer side at <date/time>.`<br>`Since this page loaded, <email> reinstated that account's tester side at <date/time>.` | `!suspendedAt && reinstatedAt && reinstatedAt > seen.since; !own` | `409 / "changed_since"`; [src/lib/server/restrictions.ts:156](../src/lib/server/restrictions.ts#L156) |
| Admin; `refuseIfChangedSince` | `Since your Preview, you reinstated that account's developer side in another tab at <date/time>.`<br>`Since your Preview, you reinstated that account's tester side in another tab at <date/time>.`<br>`Since this page loaded, you reinstated that account's developer side in another tab at <date/time>.`<br>`Since this page loaded, you reinstated that account's tester side in another tab at <date/time>.` | `!suspendedAt && reinstatedAt && reinstatedAt > seen.since; own === "other" && pressing === "suspend"` | `409 / "changed_since"`; [src/lib/server/restrictions.ts:157](../src/lib/server/restrictions.ts#L157) |
| Admin; `suspendAccount` | `That account doesn't exist.` | `!u` | `404 / "not_found"`; [src/lib/server/restrictions.ts:167](../src/lib/server/restrictions.ts#L167) |
| Admin; `suspendAccount` | `That account was deleted.` | `claimed.count !== 1; now.deletedAt` | `409 / "deleted"`; [src/lib/server/restrictions.ts:178](../src/lib/server/restrictions.ts#L178) |
| Admin; `suspendAccount` | `You already suspended the developer side in another tab at <date/time>.`<br>`You already suspended the developer side at <date/time>.`<br>`You already suspended the tester side in another tab at <date/time>.`<br>`You already suspended the tester side at <date/time>.` | `claimed.count !== 1; own` | `409 / "already"`; [src/lib/server/restrictions.ts:181](../src/lib/server/restrictions.ts#L181) |
| Admin; `suspendAccount` | `That account's developer side is already suspended (by <admin email>).`<br>`That account's developer side is already suspended.`<br>`That account's tester side is already suspended (by <admin email>).`<br>`That account's tester side is already suspended.` | `claimed.count !== 1` | `409 / "already"`; [src/lib/server/restrictions.ts:183](../src/lib/server/restrictions.ts#L183) |
| Admin; `reinstateAccount` | `That account doesn't exist.` | `!u` | `404 / "not_found"`; [src/lib/server/restrictions.ts:202](../src/lib/server/restrictions.ts#L202) |
| Admin; `reinstateAccount` | `That account isn't suspended.` | `!side` | `409 / "not_suspended"`; [src/lib/server/restrictions.ts:208](../src/lib/server/restrictions.ts#L208) |
| Admin; `reinstateAccount` | `That developer is on a chargeback hold: it has to clear before the developer side can be reinstated.`<br>`That developer is on a payment hold: it has to clear before the developer side can be reinstated.` | `side === "developer" && u.devSuspendedAt && u.holdStartedAt` | `409 / "on_hold"`; [src/lib/server/restrictions.ts:213](../src/lib/server/restrictions.ts#L213) |
| Admin; `reinstateAccount` | `You already reinstated the developer side in another tab at <date/time>.`<br>`You already reinstated the developer side at <date/time>.`<br>`You already reinstated the tester side in another tab at <date/time>.`<br>`You already reinstated the tester side at <date/time>.` | `!start \|\| lifted.count !== 1; own && ev` | `409 / "not_suspended"`; [src/lib/server/restrictions.ts:228](../src/lib/server/restrictions.ts#L228) |
| Admin; `reinstateAccount` | `That account's developer side was already reinstated (by <admin email>).`<br>`That account's developer side was already reinstated.`<br>`That account's tester side was already reinstated (by <admin email>).`<br>`That account's tester side was already reinstated.` | `!start \|\| lifted.count !== 1` | `409 / "not_suspended"`; [src/lib/server/restrictions.ts:230](../src/lib/server/restrictions.ts#L230) |
| Both sides / caller of shared check; `deleteAccount` | `That account doesn't exist.` | `!u` | `404 / "not_found"`; [src/lib/server/restrictions.ts:259](../src/lib/server/restrictions.ts#L259) |
| Both sides / caller of shared check; `deleteAccount` | `That account was already deleted.` | `u.deletedAt` | `409 / "deleted"`; [src/lib/server/restrictions.ts:260](../src/lib/server/restrictions.ts#L260) |
| Admin; `alreadyDeleted` | `You already deleted this account in another tab at <date/time>.`<br>`You already deleted this account at <date/time>.` | `own && act` | `409 / "deleted"`; [src/lib/server/restrictions.ts:302](../src/lib/server/restrictions.ts#L302) |
| Admin; `alreadyDeleted` | `That account was already deleted (by its owner at <date/time>).`<br>`That account was already deleted (by <person> at <date/time>).` | `shared check / unconditional` | `409 / "deleted"`; [src/lib/server/restrictions.ts:304](../src/lib/server/restrictions.ts#L304) |
| Admin; `adminDeleteAccount` | `That account doesn't exist.` | `!u` | `404 / "not_found"`; [src/lib/server/restrictions.ts:313](../src/lib/server/restrictions.ts#L313) |
| Admin; `allowedRefusal` | `That test's locked fields were already given 3 more changes (by <admin email> at <date/time>).`<br>`You already allowed 3 more changes of this test's locked fields in another tab at <date/time>.`<br>`You already allowed 3 more changes of this test's locked fields at <date/time>.` | `last` | `409 / "already"`; [src/lib/server/restrictions.ts:330](../src/lib/server/restrictions.ts#L330) |
| Both sides / caller of shared check; `allowLockedChanges` | `That test doesn't exist.` | `!t` | `404 / "not_found"`; [src/lib/server/restrictions.ts:340](../src/lib/server/restrictions.ts#L340) |
| Both sides / caller of shared check; `allowLockedChanges` | `None of that test's fields is locked.` | `!lockedFields(countsOf(t.criticalCounts)).length && seen` | `409 / "not_locked"`; [src/lib/server/restrictions.ts:342](../src/lib/server/restrictions.ts#L342) |
| Both sides / caller of shared check; `allowLockedChanges` | `None of that test's fields is locked.` | `!locked.length && seen` | `409 / "not_locked"`; [src/lib/server/restrictions.ts:351](../src/lib/server/restrictions.ts#L351) |
| Admin; `pauseTest` | `That test doesn't exist.` | `!t` | `404 / "not_found"`; [src/lib/server/restrictions.ts:376](../src/lib/server/restrictions.ts#L376) |
| Admin; `unpauseTest` | `That test doesn't exist.` | `!t` | `404 / "not_found"`; [src/lib/server/restrictions.ts:403](../src/lib/server/restrictions.ts#L403) |
| Admin; `adminStopTest` | `That test doesn't exist.` | `!t` | `404 / "not_found"`; [src/lib/server/restrictions.ts:426](../src/lib/server/restrictions.ts#L426) |
| Admin; `previewSuspension` | `That account doesn't exist.` | `!u` | `404 / "not_found"`; [src/lib/server/restrictions.ts:459](../src/lib/server/restrictions.ts#L459) |

### Chargeback steps and Approve / Don't approve

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `reservationChecked` | `There's nothing to confirm here.` | `!r \|\| r.developerId !== devId` | `404 / "not_found"`; [src/lib/server/chargeback.ts:102](../src/lib/server/chargeback.ts#L102) |
| Both sides / caller of shared check; `reservationChecked` | `Your bank didn't confirm the payment, so nothing was charged.` | `r.status !== "needs_action"` | `402 / "not_confirmed"`; [src/lib/server/chargeback.ts:104](../src/lib/server/chargeback.ts#L104) |
| Both sides / caller of shared check; `reservationChecked` | `Your bank didn't confirm the payment, so nothing was charged.` | `!ok` | `402 / "not_confirmed"`; [src/lib/server/chargeback.ts:107](../src/lib/server/chargeback.ts#L107) |
| Both sides / caller of shared check; `startCardVerification` | `Your account isn't on a chargeback hold, so there's nothing to verify.` | `!steps` | `409 / "no_chargeback_hold"`; [src/lib/server/chargeback.ts:152](../src/lib/server/chargeback.ts#L152) |
| Both sides / caller of shared check; `confirmCardCheck` | `There's no card form to confirm here.` | `simulated()` | `409 / "simulated"`; [src/lib/server/chargeback.ts:180](../src/lib/server/chargeback.ts#L180) |
| Both sides / caller of shared check; `confirmCardCheck` | `That card check belongs to another account.` | `si.metadata?.userId !== userId \|\| si.metadata?.purpose !== "chargeback-verify"` | `403 / "bad_setup"`; [src/lib/server/chargeback.ts:183](../src/lib/server/chargeback.ts#L183) |
| Both sides / caller of shared check; `confirmCardCheck` | `The card wasn't verified. Try again or use another card.` | `shared check / unconditional` | `409 / "not_verified"`; [src/lib/server/chargeback.ts:189](../src/lib/server/chargeback.ts#L189) |
| Both sides / caller of shared check; `finishCardCheck` | `The card wasn't verified. Try again or use another card.` | `simulated() && simulate !== "succeeded"` | `409 / "not_verified"`; [src/lib/server/chargeback.ts:195](../src/lib/server/chargeback.ts#L195) |
| Both sides / caller of shared check; `finishCardVerification` | `Your account isn't on a chargeback hold.` | `!user.holdStartedAt \|\| user.holdReason !== "chargeback"` | `409 / "no_chargeback_hold"`; [src/lib/server/chargeback.ts:205](../src/lib/server/chargeback.ts#L205) |
| Both sides / caller of shared check; `finishCardVerification` | `That card check belongs to another account.` | `si.metadata?.userId !== userId \|\| si.metadata?.purpose !== "chargeback-verify" \|\| (user.stripeCustomerId && si.customer !== user.stripeCustomerId)` | `403 / "bad_setup"`; [src/lib/server/chargeback.ts:213](../src/lib/server/chargeback.ts#L213) |
| Both sides / caller of shared check; `finishCardVerification` | `That card check is from before the hold. Verify a card again.` | `si.created * 1000 < user.holdStartedAt.getTime() - 60_000` | `409 / "old_setup"`; [src/lib/server/chargeback.ts:214](../src/lib/server/chargeback.ts#L214) |
| Both sides / caller of shared check; `finishCardVerification` | `The card wasn't verified. Try again or use another card.` | `si.status !== "succeeded"` | `409 / "not_verified"`; [src/lib/server/chargeback.ts:215](../src/lib/server/chargeback.ts#L215) |
| Both sides / caller of shared check; `finishCardVerification` | `The bank didn't confirm it was you. Try again or use another card.` | `tds && tds.result !== "authenticated" && tds.result !== "attempt_acknowledged"` | `409 / "not_verified"`; [src/lib/server/chargeback.ts:218](../src/lib/server/chargeback.ts#L218) |
| Both sides / caller of shared check; `approvedRefusal` | `That hold was already approved (by <admin email> at <date/time>).`<br>`You already approved lifting this hold in another tab at <date/time>.`<br>`You already approved lifting this hold at <date/time>.` | `shared check / unconditional` | `409 / "already"`; [src/lib/server/chargeback.ts:322](../src/lib/server/chargeback.ts#L322) |
| Admin; `approveChargebackHold` | `That account isn't on a chargeback hold.` | `!steps` | `409 / "no_chargeback_hold"`; [src/lib/server/chargeback.ts:345](../src/lib/server/chargeback.ts#L345) |
| Admin; `approveChargebackHold` | `That hold was already approved.` | `steps.approved` | `409 / "already"`; [src/lib/server/chargeback.ts:346](../src/lib/server/chargeback.ts#L346) |
| Admin; `approveChargebackHold` | `Not yet: the card isn't verified, and nothing is reserved ($X is owed; you released it in another tab at <date/time>).`<br>`Not yet: the card isn't verified, and nothing is reserved ($X is owed; <person> released it at <date/time>).`<br>`Not yet: the card isn't verified, and nothing is reserved ($X is owed).` | `!steps.cardVerified && nothingReserved` | `409 / "steps_missing"`; [src/lib/server/chargeback.ts:354](../src/lib/server/chargeback.ts#L354) |
| Admin; `approveChargebackHold` | `Not yet: the card isn't verified.` | `!steps.cardVerified` | `409 / "steps_missing"`; [src/lib/server/chargeback.ts:355](../src/lib/server/chargeback.ts#L355) |
| Admin; `approveChargebackHold` | `Not yet: nothing is reserved ($X is owed; you released it in another tab at <date/time>).`<br>`Not yet: nothing is reserved ($X is owed; <person> released it at <date/time>).`<br>`Not yet: nothing is reserved ($X is owed).` | `nothingReserved` | `409 / "steps_missing"`; [src/lib/server/chargeback.ts:356](../src/lib/server/chargeback.ts#L356) |
| Admin; `approveChargebackHold` | `That hold was already approved.` | `claimed.count !== 1` | `409 / "already"`; [src/lib/server/chargeback.ts:360](../src/lib/server/chargeback.ts#L360) |
| Admin; `approveChargebackHold` | `The reservation can't be taken any more (it expired): the developer needs to press Pay what you owe again.` | `r.stripePaymentIntentId && stripeOn()` | `409 / "reserve_expired"`; [src/lib/server/chargeback.ts:380](../src/lib/server/chargeback.ts#L380) |
| Admin; `declineChargebackReserve` | `That account isn't on a chargeback hold.` | `!u?.holdStartedAt \|\| u.holdReason !== "chargeback"` | `409 / "no_chargeback_hold"`; [src/lib/server/chargeback.ts:420](../src/lib/server/chargeback.ts#L420) |
| Admin; `declineChargebackReserve` | `That hold was already approved.` | `u.chargebackApprovedAt` | `409 / "already"`; [src/lib/server/chargeback.ts:421](../src/lib/server/chargeback.ts#L421) |
| Admin; `declineChargebackReserve` | `Nothing is reserved on that account (you released it in another tab at <date/time>).`<br>`Nothing is reserved on that account (<person> released it at <date/time>).`<br>`Nothing is reserved on that account.` | `!cents` | `409 / "nothing_reserved"`; [src/lib/server/chargeback.ts:427](../src/lib/server/chargeback.ts#L427) |

### Subscriptions and card/provider checks

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `getStripe` | `Payments aren't set up yet.` | `!key` | `503 / "payments_off"`; [src/lib/server/stripe.ts:112](../src/lib/server/stripe.ts#L112) |
| Both sides / caller of shared check; `getStripe` | `Payments are switched off right now. Try again later.` | `key.startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE !== "1"` | `503 / "payments_off"`; [src/lib/server/stripe.ts:113](../src/lib/server/stripe.ts#L113) |
| Developer / admin; tester-away card decline is translated to delayed; `charge` | `No card is saved on this account.` | `!dev.stripeCustomerId \|\| !dev.stripePaymentMethodId` | `402 / "card_failed"`; [src/lib/server/stripe.ts:164](../src/lib/server/stripe.ts#L164) |
| Developer / admin; tester-away card decline is translated to delayed; `chargeError` | `Your card couldn't be charged. Update your card in Payments and press Pay again.`<br>`Your card couldn't be charged. Update your card in Payments and try again.` | `isCardError(e)` | `402 / "card_failed"`; [src/lib/server/stripe.ts:213](../src/lib/server/stripe.ts#L213) |
| Developer / admin; tester-away card decline is translated to delayed; `chargeError` | `No card is saved on this account.` | `stripeError.type === "StripeInvalidRequestError" && (stripeError.code === "resource_missing" \|\| stripeError.raw?.code === "resource_missing")` | `402 / "card_failed"`; [src/lib/server/stripe.ts:216](../src/lib/server/stripe.ts#L216) |
| Both sides / caller of shared check; `chargeError` | `Payments are having a problem right now. Nothing was charged; try again shortly.` | `shared check / unconditional` | `503 / "payments_problem"`; [src/lib/server/stripe.ts:217](../src/lib/server/stripe.ts#L217) |
| Both sides / caller of shared check; `unknownOutcome` | `The payment key was used with other details.` | `t === "StripeIdempotencyError" \|\| t === "idempotency_error"` | `409 / "idempotency"`; [src/lib/server/stripe.ts:226](../src/lib/server/stripe.ts#L226) |
| Both sides / caller of shared check; `unknownOutcome` | `We didn't hear back from the payment service.` | `t === "StripeConnectionError" \|\| t === "StripeAPIError" \|\| t === "api_error"` | `502 / "payment_unknown"`; [src/lib/server/stripe.ts:227](../src/lib/server/stripe.ts#L227) |
| Card return callback; internal guard translated, not shown verbatim; `saveCardFromCheckout` | `That card setup belongs to another account.` | `s.customer !== user.stripeCustomerId` | `403 / "bad_session"`; [src/lib/server/stripe.ts:349](../src/lib/server/stripe.ts#L349) |
| Both sides / caller of shared check; `requirePerk` | `<PERKS[perk]> need a subscription ($X/month).`<br>`<PERKS[perk]> needs a subscription ($X/month).` | `shared check / unconditional` | `409 / "subscription"`; [src/lib/server/subscription.ts:53](../src/lib/server/subscription.ts#L53) |
| Both sides / caller of shared check; `canOpenAnother` | `You have 10 open tests, the most you can have at once. Stop or close one to post another.` | `await hasPerks(await userOf(devId)); open >= MAX_OPEN_TESTS` | `409 / "too_many_open"`; [src/lib/server/subscription.ts:66](../src/lib/server/subscription.ts#L66) |
| Both sides / caller of shared check; `canOpenAnother` | `You already have an open test. Subscribe ($X/month) to run several at once.` | `open >= 1` | `409 / "subscription"`; [src/lib/server/subscription.ts:69](../src/lib/server/subscription.ts#L69) |
| Both sides / caller of shared check; `subscribe` | `Only developers subscribe.` | `!u.isDeveloper` | `403 / "not_developer"`; [src/lib/server/subscription.ts:119](../src/lib/server/subscription.ts#L119) |
| Both sides / caller of shared check; `subscribe` | `You can subscribe once your account is active again.` | `u.holdStartedAt \|\| u.devSuspendedAt` | `409 / "restricted"`; [src/lib/server/subscription.ts:121](../src/lib/server/subscription.ts#L121) |
| Both sides / caller of shared check; `subscribe` | `Press Keep my subscription to keep it.`<br>`You're already subscribed.` | `subscribed(u, now)` | `409 / "already"`; [src/lib/server/subscription.ts:122](../src/lib/server/subscription.ts#L122) |
| Both sides / caller of shared check; `subscribe` | `Everything is free during launch: there's nothing to subscribe to yet.` | `launch.free && !launch.until` | `409 / "free"`; [src/lib/server/subscription.ts:124](../src/lib/server/subscription.ts#L124) |
| Both sides / caller of shared check; `subscribe` | `Add a card first, then subscribe.` | `stripeOn() && (!u.stripeCustomerId \|\| !u.stripePaymentMethodId)` | `409 / "no_card"`; [src/lib/server/subscription.ts:125](../src/lib/server/subscription.ts#L125) |
| Both sides / caller of shared check; `subscribe` | `Your card was declined, so you're not subscribed. Update your card and try again.` | `billingOn(); (e as Error).message === "incomplete" \|\| isCardError(e)` | `402 / "card_failed"`; [src/lib/server/subscription.ts:170](../src/lib/server/subscription.ts#L170) |
| Both sides / caller of shared check; `subscribe` | `Payments are having a problem right now. Nothing was charged; try again shortly.` | `billingOn(); (e as Error).message === "incomplete" \|\| isCardError(e)` | `503 / "payments_problem"`; [src/lib/server/subscription.ts:170](../src/lib/server/subscription.ts#L170) |
| Both sides / caller of shared check; `subscribe` | `Your card was declined, so you're not subscribed. Update your card and try again.` | `billingOn(); startsCharging <= now; !r` | `402 / "card_failed"`; [src/lib/server/subscription.ts:178](../src/lib/server/subscription.ts#L178) |
| Both sides / caller of shared check; `cancelSubscription` | `Your subscription is already cancelled.` | `subscribed(u, now) && u.subscriptionCanceling` | `409 / "already"`; [src/lib/server/subscription.ts:218](../src/lib/server/subscription.ts#L218) |
| Both sides / caller of shared check; `cancelSubscription` | `There's no subscription to cancel.` | `!subscribed(u, now)` | `409 / "none"`; [src/lib/server/subscription.ts:219](../src/lib/server/subscription.ts#L219) |
| Both sides / caller of shared check; `keepSubscription` | `You're already subscribed.` | `subscribed(u, now) && !u.subscriptionCanceling` | `409 / "already"`; [src/lib/server/subscription.ts:229](../src/lib/server/subscription.ts#L229) |
| Both sides / caller of shared check; `keepSubscription` | `There's nothing to keep.` | `!u.subscriptionCanceling \|\| !subscribed(u, now)` | `409 / "none"`; [src/lib/server/subscription.ts:230](../src/lib/server/subscription.ts#L230) |

### Excerpt request / Accept / Decline / Remove

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Developer; `requestExcerpt` | `That part doesn't exist or isn't yours.` | `!sub \|\| sub.contract.testerId !== tester.id` | `404 / "not_found"`; [src/lib/server/excerpts.ts:71](../src/lib/server/excerpts.ts#L71) |
| Developer; `requestExcerpt` | `This test now has an NDA, so its work can't be shown as an excerpt.` | `t.ndaText` | `409 / "nda"`; [src/lib/server/excerpts.ts:73](../src/lib/server/excerpts.ts#L73) |
| Developer; `requestExcerpt` | `Only written answers the developer paid for can be shown as excerpts.` | `!choices.length` | `409 / "not_paid"`; [src/lib/server/excerpts.ts:75](../src/lib/server/excerpts.ts#L75) |
| Developer; `requestExcerpt` | `You already asked to show an excerpt from this part. Wait for the developer's answer.` | `await tx.excerpt.count({ where: { submissionId: sub.id, status: "pending" } })` | `409 / "pending"`; [src/lib/server/excerpts.ts:85](../src/lib/server/excerpts.ts#L85) |
| Developer; `requestExcerpt` | `You can show at most 3 excerpts. Remove one first.` | `(await tx.excerpt.count({ where: { testerId: tester.id, status: { in: ["pending", "shown"] } } })) >= MAX_EXCERPTS` | `409 / "too_many"`; [src/lib/server/excerpts.ts:86](../src/lib/server/excerpts.ts#L86) |
| Tester; `decideExcerpt` | `This request was already decided.` | `!x \|\| x.test.developerId !== dev.id` | `404 / "gone"`; [src/lib/server/excerpts.ts:98](../src/lib/server/excerpts.ts#L98) |
| Tester; `decideExcerpt` | `You already allowed this excerpt.`<br>`You already denied this excerpt.`<br>`This request was already decided.` | `x.status !== "pending"` | `409 / "decided"`; [src/lib/server/excerpts.ts:100](../src/lib/server/excerpts.ts#L100) |
| Tester; `decideExcerpt` | `This request was already decided.` | `done.count !== 1` | `409 / "decided"`; [src/lib/server/excerpts.ts:103](../src/lib/server/excerpts.ts#L103) |
| Both sides / caller of shared check; `removeExcerpt` | `Only the tester can remove an excerpt from their profile.` | `x && x.testerId !== user.id && x.test.developerId === user.id` | `409 / "tester_only"`; [src/lib/server/excerpts.ts:115](../src/lib/server/excerpts.ts#L115) |
| Both sides / caller of shared check; `removeExcerpt` | `This excerpt was already taken down.` | `!x \|\| x.testerId !== user.id` | `404 / "gone"`; [src/lib/server/excerpts.ts:116](../src/lib/server/excerpts.ts#L116) |
| Both sides / caller of shared check; `removeExcerpt` | `This excerpt was already taken down.` | `gone.count !== 1` | `404 / "gone"`; [src/lib/server/excerpts.ts:118](../src/lib/server/excerpts.ts#L118) |

### Messages, reports, account / authentication and shared access

| Who / press / shared check | Exact reason or common-family reference | Trigger (code condition) | HTTP / code / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `finishGoogleSignup` | `This Google sign-up expired. Continue with Google again.` | `!step \|\| !token` | `409 / "expired"`; [src/lib/server/google.ts:163](../src/lib/server/google.ts#L163) |
| Both sides / caller of shared check; `readJson` | `Something went wrong sending that. Reload the page and try again.` | `!type.includes("application/json")` | `415 / "bad_request"`; [src/lib/server/http.ts:17](../src/lib/server/http.ts#L17) |
| Both sides / caller of shared check; `readJson` | `That request came from another site, so it was blocked.` | `origin && !sameOrigin(req, origin)` | `403 / "bad_origin"`; [src/lib/server/http.ts:19](../src/lib/server/http.ts#L19) |
| Both sides / caller of shared check; `checkAdminKey` | `Only admins can do that.` | `!u \|\| !isAdmin(u)` | `403 / "not_admin"`; [src/lib/server/kept.ts:27](../src/lib/server/kept.ts#L27) |
| Both sides / caller of shared check; `chatAccess` | `That chat doesn't exist.` | `!test \|\| (userId !== testerId && userId !== test.developerId) \|\| testerId === test.developerId` | `404 / "not_found"`; [src/lib/server/messages.ts:15](../src/lib/server/messages.ts#L15) |
| Both sides / caller of shared check; `chatAccess` | `That chat doesn't exist.` | `!contract` | `404 / "not_found"`; [src/lib/server/messages.ts:18](../src/lib/server/messages.ts#L18) |
| Both sides / caller of shared check; `openTesterChat` | `That chat doesn't exist.` | `!c \|\| (c.test.developerId !== who.id && c.testerId !== who.id)` | `404 / "not_found"`; [src/lib/server/messages.ts:45](../src/lib/server/messages.ts#L45) |
| Both sides / caller of shared check; `openTesterChat` | `Unable to chat with this developer.` | `c.testerId === who.id; !a \|\| a.blocked \|\| who.testerSuspendedAt` | `409 / "unable"`; [src/lib/server/messages.ts:50](../src/lib/server/messages.ts#L50) |
| Both sides / caller of shared check; `openTesterChat` | `Unable to chat with this tester.` | `c.testerId === who.id; !a \|\| a.blocked \|\| who.devSuspendedAt \|\| who.holdStartedAt` | `409 / "unable"`; [src/lib/server/messages.ts:51](../src/lib/server/messages.ts#L51) |
| Both sides / caller of shared check; `chatFor` | `That chat doesn't exist.` | `!c \|\| (c.testerId !== userId && c.test.developerId !== userId)` | `404 / "not_found"`; [src/lib/server/messages.ts:58](../src/lib/server/messages.ts#L58) |
| Both sides / caller of shared check; `sendChat` | `This chat is closed.` | `a.blocked` | `409 / "closed"`; [src/lib/server/messages.ts:72](../src/lib/server/messages.ts#L72) |
| Both sides / caller of shared check; `sendChat` | `Your tests are paused.`<br>`Your account is paused.` | `iAmDev ? r.developer : r.tester` | `403 / iAmDev && !r.dev.devSuspendedAt ? "held" : "suspended"`; [src/lib/server/messages.ts:83](../src/lib/server/messages.ts#L83) |
| Both sides / caller of shared check; `sendChat` | `Messages are paused for now, so this wasn't sent.` | `iAmDev ? r.tester : r.developer` | `409 / "chat_paused"`; [src/lib/server/messages.ts:84](../src/lib/server/messages.ts#L84) |
| Both sides / caller of shared check; `sendChat` | `You're sending messages very fast. Wait a minute, then send again.` | `(await db.message.count({ where: { senderId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } } })) >= CHAT_PER_MINUTE` | `429 / "too_fast"`; [src/lib/server/messages.ts:87](../src/lib/server/messages.ts#L87) |
| Both sides / caller of shared check; `networkLimit` | `Too many reset requests from here. Try again in an hour.` | `(await db.loginAttempt.count({ where: { kind, ip, at: { gt: new Date(now.getTime() - windowMs) } } })) >= max` | `429 / "too_many"`; [src/lib/server/passwords.ts:71](../src/lib/server/passwords.ts#L71) |
| Both sides / caller of shared check; `signUp` | `Too many new accounts from here. Try again in an hour.` | `ip && (await db.loginAttempt.count({ where: { kind: "signup", ok: true, ip, at: { gt: new Date(now.getTime() - 3_600_000) } } })) >= SIGNUPS_PER_NETWORK_HOUR` | `429 / "too_many"`; [src/lib/server/passwords.ts:95](../src/lib/server/passwords.ts#L95) |
| Both sides / caller of shared check; `logIn` | `Too many tries. Wait 15 minutes or reset your password.` | `await loginPaused(email, ip, now)` | `429 / "too_many"`; [src/lib/server/passwords.ts:127](../src/lib/server/passwords.ts#L127) |
| Both sides / caller of shared check; `resetPassword` | `This link has expired or was already used. Ask for a new one.` | `shared check / unconditional` | `409 / "bad_link"`; [src/lib/server/passwords.ts:178](../src/lib/server/passwords.ts#L178) |
| Both sides / caller of shared check; `sendVerification` | `Your email is already confirmed.` | `user.emailVerifiedAt` | `409 / "confirmed"`; [src/lib/server/passwords.ts:214](../src/lib/server/passwords.ts#L214) |
| Both sides / caller of shared check; `sendVerification` | `We've sent a few already: check your inbox (and spam), or try again in an hour` | `(await recentlySent(user.email, "verify")) >= EMAILS_PER_HOUR` | `429 / "rate_limited"`; [src/lib/server/passwords.ts:215](../src/lib/server/passwords.ts#L215) |
| Both sides / caller of shared check; `reportPerson` | `That person doesn't exist.` | `!other \|\| other.deletedAt` | `404 / "not_found"`; [src/lib/server/reports.ts:16](../src/lib/server/reports.ts#L16) |
| Both sides / caller of shared check; `reportPerson` | `You already reported <person> on <date/time>.` | `had` | `409 / "already"`; [src/lib/server/reports.ts:19](../src/lib/server/reports.ts#L19) |
| Both sides / caller of shared check; `reportPerson` | `You already reported <person>.` | `!r` | `409 / "already"`; [src/lib/server/reports.ts:22](../src/lib/server/reports.ts#L22) |
| Both sides / caller of shared check; `getUserFromRequest` | `You're signed in as someone else in another tab. This page is switching to that account.` | `u && page && page !== u.id` | `409 / "account_changed"`; [src/lib/server/session.ts:47](../src/lib/server/session.ts#L47) |
| Both sides / caller of shared check; `alertsTest` | `That test doesn't exist.` | `!t \|\| t.developerId !== userId` | `404 / "not_found"`; [src/lib/server/testAlerts.ts:8](../src/lib/server/testAlerts.ts#L8) |
| Both sides / caller of shared check; `requireActive` | `Your account is suspended: your tests are paused. Contact us in Settings to appeal.`<br>`Your account is paused. Contact support if you think this is a mistake.` | `asDev ? u.devSuspendedAt : u.testerSuspendedAt` | `403 / "suspended"`; [src/lib/server/users.ts:72](../src/lib/server/users.ts#L72) |
| Both sides / caller of shared check; `requireActive` | `Your tests are paused after a chargeback. Open Payments to see the steps.`<br>`Your tests are paused until you pay what you owe. Open Payments to pay.` | `u.holdStartedAt && u.isDeveloper && asDev && (opts.devSide === true \|\| opts.devSide === "auto")` | `403 / "held"`; [src/lib/server/users.ts:75](../src/lib/server/users.ts#L75) |
| Both sides / caller of shared check; `requireConfirmed` | `Confirm your email first. We sent a link to <your email>.`<br>`Confirm your email first.` | `!u.emailVerifiedAt` | `409 / "confirm_email"`; [src/lib/server/users.ts:91](../src/lib/server/users.ts#L91) |

### Route-specific checks and page/poll responses

These wrap the server checks above. GET/pulse/live failures protect reads; they are listed for completeness rather than counted as a pressed-button stop. Session-route final/paused checks can move a refused old press to the session top banner. Admin endpoints are called by their displayed admin buttons and row-expansion presses.

| Who / endpoint / owner | Exact reason / family | Trigger | HTTP / source |
| --- | --- | --- | --- |
| Both sides / caller of shared check; `/api/account/side/route.ts`; `POST` | `An admin account is only for the admin console. To post or test, use a separate account.` | `isAdmin(u)` | `409 / "admin_only"`; [src/app/api/account/side/route.ts:12](../src/app/api/account/side/route.ts#L12) |
| Both sides / caller of shared check; `/api/account/side/route.ts`; `POST` | `Your account doesn't have that side yet.` | `!has && b.add !== true` | `409 / "no_side"`; [src/app/api/account/side/route.ts:17](../src/app/api/account/side/route.ts#L17) |
| Admin; `/api/admin/dispute/route.ts`; `GET` | `Your account is paused.` | `adminAccount(u) && !isAdmin(u)` | `403 / "suspended"`; [src/app/api/admin/dispute/route.ts:9](../src/app/api/admin/dispute/route.ts#L9) |
| Admin; `/api/admin/dispute/route.ts`; `GET` | `Only admins can do that.` | `!isAdmin(u)` | `403 / "not_admin"`; [src/app/api/admin/dispute/route.ts:10](../src/app/api/admin/dispute/route.ts#L10) |
| Admin; `/api/admin/dispute/route.ts`; `GET` | `That dispute doesn't exist.` | `!d` | `404 / "not_found"`; [src/app/api/admin/dispute/route.ts:12](../src/app/api/admin/dispute/route.ts#L12) |
| Admin; `/api/admin/more/route.ts`; `GET` | `Your account is paused.` | `adminAccount(u) && !isAdmin(u)` | `403 / "suspended"`; [src/app/api/admin/more/route.ts:11](../src/app/api/admin/more/route.ts#L11) |
| Admin; `/api/admin/more/route.ts`; `GET` | `Only admins can do that.` | `!isAdmin(u)` | `403 / "not_admin"`; [src/app/api/admin/more/route.ts:12](../src/app/api/admin/more/route.ts#L12) |
| Admin; `/api/admin/[action]/route.ts`; `teamCloseScope` | `That account or test doesn't exist.` | `!id` | `404 / "not_found"`; [src/app/api/admin/[action]/route.ts:18](../src/app/api/admin/[action]/route.ts#L18) |
| Admin; `/api/admin/[action]/route.ts`; `POST` | `Your account is paused.` | `adminAccount(u) && !isAdmin(u)` | `403 / "suspended"`; [src/app/api/admin/[action]/route.ts:28](../src/app/api/admin/[action]/route.ts#L28) |
| Admin; `/api/admin/[action]/route.ts`; `POST` | `Only admins can do that.` | `!isAdmin(u)` | `403 / "not_admin"`; [src/app/api/admin/[action]/route.ts:29](../src/app/api/admin/[action]/route.ts#L29) |
| Admin; `/api/admin/[action]/route.ts`; `run` | `That message doesn't exist.` | `case "contact-replied"; done.count !== 1; !m` | `404 / "not_found"`; [src/app/api/admin/[action]/route.ts:51](../src/app/api/admin/[action]/route.ts#L51) |
| Admin; `/api/admin/[action]/route.ts`; `run` | `You already marked this replied in another tab at <date/time>.`<br>`You already marked this replied at <date/time>.` | `case "contact-replied"; done.count !== 1; own && m.repliedAt` | `409 / "replied"`; [src/app/api/admin/[action]/route.ts:54](../src/app/api/admin/[action]/route.ts#L54) |
| Admin; `/api/admin/[action]/route.ts`; `run` | `<by?.email> already marked this replied at <date/time>.`<br>`<by?.email> already marked this replied.`<br>`An admin (deleted) already marked this replied at <date/time>.`<br>`An admin (deleted) already marked this replied.` | `case "contact-replied"; done.count !== 1` | `409 / "replied"`; [src/app/api/admin/[action]/route.ts:56](../src/app/api/admin/[action]/route.ts#L56) |
| Admin; `/api/admin/[action]/route.ts`; `run` | `You can't pause your own account.` | `case "suspend"; id === u.id` | `409 / "self"`; [src/app/api/admin/[action]/route.ts:63](../src/app/api/admin/[action]/route.ts#L63) |
| Admin; `/api/admin/[action]/route.ts`; `run` | `Use Settings to delete your own account.` | `case "delete-account"; id === u.id` | `409 / "self"`; [src/app/api/admin/[action]/route.ts:75](../src/app/api/admin/[action]/route.ts#L75) |
| Admin; `/api/admin/[action]/route.ts`; `run` | `That action doesn't exist.` | `shared check / unconditional` | `404 / "not_found"`; [src/app/api/admin/[action]/route.ts:120](../src/app/api/admin/[action]/route.ts#L120) |
| Both sides / caller of shared check; `/api/help/route.ts`; `POST` | `You've sent <LIMITS.contactPerDay> messages today. We'll reply by email.` | `today >= CONTACT_LIMIT_PER_DAY` | `409 / "limit"`; [src/app/api/help/route.ts:23](../src/app/api/help/route.ts#L23) |
| Both sides / caller of shared check; `/api/invites/[id]/route.ts`; `POST` | `That invite doesn't exist.` | `!inv \|\| inv.testerId !== u.id` | `404 / "not_found"`; [src/app/api/invites/[id]/route.ts:20](../src/app/api/invites/[id]/route.ts#L20) |
| Both sides / caller of shared check; `/api/invites/[id]/route.ts`; `POST` | `This invite is no longer open.`<br>`This test was stopped.`<br>`“<test>” closed to new testers on <date/time>.`<br>`“<test>” isn't taking new testers right now, so this invite was closed.` | `inv.status === "replaced"; !fresh` | `409 / "invite_closed"`; [src/app/api/invites/[id]/route.ts:24](../src/app/api/invites/[id]/route.ts#L24) |
| Both sides / caller of shared check; `/api/invites/[id]/route.ts`; `POST` | `This invite is no longer open.`<br>`This test was stopped.`<br>`“<test>” closed to new testers on <date/time>.`<br>`“<test>” isn't taking new testers right now, so this invite was closed.` | `inv.status === "cancelled"` | `409 / "invite_closed"`; [src/app/api/invites/[id]/route.ts:42](../src/app/api/invites/[id]/route.ts#L42) |
| Both sides / caller of shared check; `/api/invites/[id]/route.ts`; `POST` | `You already joined.` | `inv.status === "joined"` | `409 / "gone"`; [src/app/api/invites/[id]/route.ts:43](../src/app/api/invites/[id]/route.ts#L43) |
| Both sides / caller of shared check; `/api/invites/[id]/route.ts`; `POST` | `This invite is no longer open.` | `inv.status !== "sent"` | `409 / "invite_closed"`; [src/app/api/invites/[id]/route.ts:44](../src/app/api/invites/[id]/route.ts#L44) |
| Both sides / caller of shared check; `/api/live/route.ts`; `GET` | `That session doesn't exist.` | `kind === "session"; !c \|\| c.testerId !== u.id` | `404 / "not_found"`; [src/app/api/live/route.ts:40](../src/app/api/live/route.ts#L40) |
| Both sides / caller of shared check; `/api/live/route.ts`; `GET` | `Nothing to watch here.` | `kind === "session"; kind === "test"; kind === "listing"; kind === "invites"` | `404 / "not_found"`; [src/app/api/live/route.ts:73](../src/app/api/live/route.ts#L73) |
| Both sides / caller of shared check; `/api/payments/confirm/route.ts`; `POST` | `This account was deleted.` | `u.deletedAt` | `403 / "deleted"`; [src/app/api/payments/confirm/route.ts:12](../src/app/api/payments/confirm/route.ts#L12) |
| Both sides / caller of shared check; `/api/payments/owed/route.ts`; `POST` | `Your account is suspended: your tests are paused. Contact us in Settings to appeal.` | `u.devSuspendedAt && !u.holdStartedAt` | `403 / "suspended"`; [src/app/api/payments/owed/route.ts:11](../src/app/api/payments/owed/route.ts#L11) |
| Both sides / caller of shared check; `/api/payments/subscription/route.ts`; `POST` | `This account was deleted.` | `u.deletedAt` | `403 / "deleted"`; [src/app/api/payments/subscription/route.ts:15](../src/app/api/payments/subscription/route.ts#L15) |
| Both sides / caller of shared check; `/api/payments/subscription/route.ts`; `POST` | `Your subscription is already cancelled.` | `body.action === "cancel" && on && u.subscriptionCanceling` | `409 / "already"`; [src/app/api/payments/subscription/route.ts:20](../src/app/api/payments/subscription/route.ts#L20) |
| Both sides / caller of shared check; `/api/payments/subscription/route.ts`; `POST` | `You're already subscribed.` | `body.action !== "cancel" && on && !u.subscriptionCanceling` | `409 / "already"`; [src/app/api/payments/subscription/route.ts:21](../src/app/api/payments/subscription/route.ts#L21) |
| Both sides / caller of shared check; `/api/pulse/route.ts`; `GET` | `Only admins can do that.` | `adminPerson \|\| q.get("adminConsole"); !isAdmin(u)` | `403 / "not_admin"`; [src/app/api/pulse/route.ts:22](../src/app/api/pulse/route.ts#L22) |
| Both sides / caller of shared check; `/api/pulse/route.ts`; `GET` | `Not found.` | `inviteTest; !t \|\| t.developerId !== u.id` | `404 / "not_found"`; [src/app/api/pulse/route.ts:72](../src/app/api/pulse/route.ts#L72) |
| Both sides / caller of shared check; `/api/pulse/route.ts`; `GET` | `Not found.` | `sessionId; !c \|\| c.testerId !== u.id` | `404 / "not_found"`; [src/app/api/pulse/route.ts:91](../src/app/api/pulse/route.ts#L91) |
| Both sides / caller of shared check; `/api/pulse/route.ts`; `GET` | `Not found.` | `!t \|\| (!sessionId && t.developerId !== u.id)` | `404 / "not_found"`; [src/app/api/pulse/route.ts:95](../src/app/api/pulse/route.ts#L95) |
| Both sides / caller of shared check; `/api/recordings/[id]/upload/route.ts`; `PUT` | `Not found.` | `r2On()` | `404 / "not_found"`; [src/app/api/recordings/[id]/upload/route.ts:9](../src/app/api/recordings/[id]/upload/route.ts#L9) |
| Both sides / caller of shared check; `/api/recordings/[id]/upload/route.ts`; `PUT` | `That upload doesn't exist.` | `!rec \|\| rec.contract.testerId !== u.id` | `404 / "not_found"`; [src/app/api/recordings/[id]/upload/route.ts:13](../src/app/api/recordings/[id]/upload/route.ts#L13) |
| Both sides / caller of shared check; `/api/recordings/[id]/upload/route.ts`; `PUT` | `This file was already uploaded.` | `rec.uploadedAt` | `409 / "done"`; [src/app/api/recordings/[id]/upload/route.ts:14](../src/app/api/recordings/[id]/upload/route.ts#L14) |
| Tester; `/api/sessions/[id]/[action]/route.ts`; `finalRefusal` | `This call was cancelled when the test stopped.` | `workOver(c); action === "cancel-call" \|\| action === "cancel-set"` | `409 / "call_cancelled"`; [src/app/api/sessions/[id]/[action]/route.ts:44](../src/app/api/sessions/[id]/[action]/route.ts#L44) |
| Tester; `/api/sessions/[id]/[action]/route.ts`; `finalRefusal` | `<work-over first half>, so your <press> didn't go through. Work you sent is still reviewed.` | `workOver(c)` | `409 / "work_over"`; [src/app/api/sessions/[id]/[action]/route.ts:46](../src/app/api/sessions/[id]/[action]/route.ts#L46) |
| Tester; `/api/sessions/[id]/[action]/route.ts`; `finalRefusal` | `You rated this test, so your part is finished.`<br>`You left this test.`<br>`Your session on <test> ended.`<br>`Your session on this test ended.`<br>`This test was stopped at <time>. Work you sent is still reviewed.`<br>`This test was stopped on <date/time>. Work you sent is still reviewed.`<br>`<person> stopped the test on <date/time>. Work you sent is still reviewed.`<br>`This test ended on <date/time>. Work you sent is still reviewed.`<br>`<person> finished your part in <test>. Work you sent is still reviewed.`<br>`<person> finished your part in this test. Work you sent is still reviewed.`<br>`<person> ended your session early on <date/time>. Work you sent is still reviewed.`<br>`This test closed on <date/time>.` | `line` | `409 / "gone"`; [src/app/api/sessions/[id]/[action]/route.ts:49](../src/app/api/sessions/[id]/[action]/route.ts#L49) |
| Admin; `/api/sessions/[id]/[action]/route.ts`; `pausedRefusal` | `This test is paused right now. You can send this once it resumes.` | `SEND_ACTIONS.has(action) \|\| !PAUSE_DEFAULTS.draftsEditable` | `409 / "paused"`; [src/app/api/sessions/[id]/[action]/route.ts:64](../src/app/api/sessions/[id]/[action]/route.ts#L64) |
| Tester; `/api/sessions/[id]/[action]/route.ts`; `limitedUser` | `You can rate once your account is active again.`<br>`You can do this once your account is active again.` | `action === "choose" \|\| action === "rate"; me.testerSuspendedAt` | `409 / "inactive"`; [src/app/api/sessions/[id]/[action]/route.ts:108](../src/app/api/sessions/[id]/[action]/route.ts#L108) |
| Tester; `/api/sessions/[id]/[action]/route.ts`; `run` | `That card isn't there any more.` | `case "dismiss-removed"; !c \|\| c.testerId !== u.id \|\| c.endKind !== "suspended"` | `404 / "not_found"`; [src/app/api/sessions/[id]/[action]/route.ts:147](../src/app/api/sessions/[id]/[action]/route.ts#L147) |
| Tester; `/api/sessions/[id]/[action]/route.ts`; `run` | `That action doesn't exist.` | `shared check / unconditional` | `404 / "not_found"`; [src/app/api/sessions/[id]/[action]/route.ts:192](../src/app/api/sessions/[id]/[action]/route.ts#L192) |
| Developer; `/api/tests/[id]/[action]/route.ts`; `GET` | `That doesn't exist.` | `action !== "listing"` | `404 / "not_found"`; [src/app/api/tests/[id]/[action]/route.ts:36](../src/app/api/tests/[id]/[action]/route.ts#L36) |
| Developer; `/api/tests/[id]/[action]/route.ts`; `adminRefusal` | `The team stopped this test.` | `t.adminStoppedAt && !STOPPED_ALLOWS.has(action)` | `409 / "admin_stopped"`; [src/app/api/tests/[id]/[action]/route.ts:78](../src/app/api/tests/[id]/[action]/route.ts#L78) |
| Developer; `/api/tests/[id]/[action]/route.ts`; `adminRefusal` | `The team paused this test: you can stop it, end testers' work early, or cancel calls.` | `t.adminPausedAt && !TEAM_PAUSED_OK_ACTIONS.has(action)` | `409 / "admin_paused"`; [src/app/api/tests/[id]/[action]/route.ts:82](../src/app/api/tests/[id]/[action]/route.ts#L82) |
| Developer; `/api/tests/[id]/[action]/route.ts`; `run` | `That action doesn't exist.` | `shared check / unconditional` | `404 / "not_found"`; [src/app/api/tests/[id]/[action]/route.ts:175](../src/app/api/tests/[id]/[action]/route.ts#L175) |

### Shared formatting and additional stop constructors

Some reusable constructors are also used as F reasons, I banners or an S line. These entries inherit the reader/press/Alerts/location/lifetime of their call sites in the preceding tables; a constructor is not an extra independently displayed notice. This index records their actual literal branches. The referenced source function and parameter names make conditional phrases explicit; do not concatenate mutually exclusive alternatives. User-supplied reasons, notes, titles, dates, names and limits are placeholders.

**CALL_CHECK_BLOCKED** — [src/components/CallCheck.tsx:10](../src/components/CallCheck.tsx#L10)

* `Allow your camera and microphone in the browser's permission prompt to check them.`

**bankTopHeading** — [src/lib/bankTop.ts:15](../src/lib/bankTop.ts#L15)

* `Your bank wants you to confirm (<count>)`

**confirmByText** — [src/lib/bankTop.ts:21](../src/lib/bankTop.ts#L21)

* `confirm by <date/time>, <date/time>`
* `confirm by today, <date/time>`
* `confirm by tomorrow, <date/time>`

**bankTopLead** — [src/lib/bankTop.ts:41](../src/lib/bankTop.ts#L41)

* `$X for your plan`
* `$X on “<test>” · <what>`
* `$X · <what>`

**callLengthLine** — [src/lib/callMeasure.ts:83](../src/lib/callMeasure.ts#L83)

* `Call in progress / measuring`
* `Length: <x.actualMinutes> min (lowered from <x.measuredMinutes> min; both in the call <ma[1]>–<date/time>)`
* `Length: <x.actualMinutes> min (lowered from <x.measuredMinutes> min; both in the call <date/time>–<date/time>)`
* `Length: <x.actualMinutes> min (lowered from <x.measuredMinutes> min)`
* `Length: <x.actualMinutes> min (both in the call <ma[1]>–<date/time>)`
* `Length: <x.actualMinutes> min (both in the call <date/time>–<date/time>)`
* `Length: <x.actualMinutes> min`
* `Length: <x.measuredMinutes> min (both in the call <ma[1]>–<date/time>)`
* `Length: <x.measuredMinutes> min (both in the call <date/time>–<date/time>)`
* `Length: <x.measuredMinutes> min`
* `Length: 0 min (both in the call <ma[1]>–<date/time>)`
* `Length: 0 min (both in the call <date/time>–<date/time>)`
* `Length: 0 min`

**callsCeilingLine** — [src/lib/callMeasure.ts:101](../src/lib/callMeasure.ts#L101)

* `Calls with <person> on this test can come to at most $X; $X is left, so this call can't be booked.`

**endWarnLine** — [src/lib/callMeasure.ts:174](../src/lib/callMeasure.ts#L174)

* `This call ends at <time>.`

**capEndedLine** — [src/lib/callMeasure.ts:176](../src/lib/callMeasure.ts#L176)

* `Call ended: the $X for calls with <person> on this test is reached.`

**LENGTH_ENDED_LINE** — [src/lib/callMeasure.ts:178](../src/lib/callMeasure.ts#L178)

* `Call ended: it reached 150% of the booked time.`

**closedEndedLine** — [src/lib/callMeasure.ts:180](../src/lib/callMeasure.ts#L180)

* `Call ended: <closedLine>`

**CALL_NOT_AVAILABLE** — [src/lib/callMeasure.ts:182](../src/lib/callMeasure.ts#L182)

* `This call isn't available.`

**CALL_OVER_LINE** — [src/lib/callMeasure.ts:186](../src/lib/callMeasure.ts#L186)

* `This call is over.`

**lengthCapLine** — [src/lib/callMeasure.ts:201](../src/lib/callMeasure.ts#L201)

* `At most <max> minutes: the $X for calls with <person> on this test.`

**profileUpdatedLabel** — [src/lib/gaps.ts:29](../src/lib/gaps.ts#L29)

* `You updated your profile in another tab (<time>):`

**needsChangedLabel** — [src/lib/gaps.ts:31](../src/lib/gaps.ts#L31)

* `<dev> changed what this test needs (<time>):`

**EVERYONE_MEETS** — [src/lib/gaps.ts:52](../src/lib/gaps.ts#L52)

* `Everyone you ticked now meets this test's needs. Press Invite to send.`

**pressToLine** — [src/lib/gaps.ts:94](../src/lib/gaps.ts#L94)

* `Press <TESTER_ASK[ask].plain> to <TESTER_ASK[ask].plain>.`

**missingNeedText** — [src/lib/gaps.ts:106](../src/lib/gaps.ts#L106)

* `doesn't list a language this test needs (<items>) or a device it needs (<items>)`
* `doesn't list a language this test needs (<items>) or a device it needs (<items> or <x[x.length - 1]>)`
* `doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items>)`
* `doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items> or <x[x.length - 1]>)`
* `doesn't list a language this test needs (<items>)`
* `doesn't list a language this test needs (<items> or <x[x.length - 1]>)`
* `doesn't list a device this test needs (<items>)`
* `doesn't list a device this test needs (<items> or <x[x.length - 1]>)`

**missingNeedLine** — [src/lib/gaps.ts:113](../src/lib/gaps.ts#L113)

* `<tester> doesn't list a language this test needs (<items>) or a device it needs (<items>).`
* `<tester> doesn't list a language this test needs (<items>) or a device it needs (<items> or <x[x.length - 1]>).`
* `<tester> doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items>).`
* `<tester> doesn't list a language this test needs (<items> or <x[x.length - 1]>) or a device it needs (<items> or <x[x.length - 1]>).`
* `<tester> doesn't list a language this test needs (<items>).`
* `<tester> doesn't list a language this test needs (<items> or <x[x.length - 1]>).`
* `<tester> doesn't list a device this test needs (<items>).`
* `<tester> doesn't list a device this test needs (<items> or <x[x.length - 1]>).`

**keysAddedLine** — [src/lib/keys.ts:48](../src/lib/keys.ts#L48)

* `Added: <items>`

**keysRemovedLine** — [src/lib/keys.ts:49](../src/lib/keys.ts#L49)

* `Removed: <items>`

**pauseCountdownLine** — [src/lib/pause.ts:50](../src/lib/pause.ts#L50)

* `Closes on <date/time> unless your account is cleared`
* `Closes on <date/time> unless the team lifts the pause`

**pauseClosedReason** — [src/lib/pause.ts:56](../src/lib/pause.ts#L56)

* `The team closed this test while it was paused because <items>.`
* `The team closed this test while it was paused because <items> and <why[why.length - 1]>.`
* `The team closed this test while it was paused because it was paused.`
* `This test was closed because it stayed paused for 7 days: <items>.`
* `This test was closed because it stayed paused for 7 days: <items> and <why[why.length - 1]>.`

**testerRefusal** — [src/lib/rules.ts:184](../src/lib/rules.ts#L184)

* `You rated this test, so your part is finished.`
* `You left this test.`
* `Your session on <test> ended.`
* `Your session on this test ended.`
* `This test was stopped at <time>. Work you sent is still reviewed.`
* `This test was stopped on <date/time>. Work you sent is still reviewed.`
* `This test ended on <date/time>. Work you sent is still reviewed.`
* `This test closed on <date/time>.`

**closedToNewLine** — [src/lib/rules.ts:351](../src/lib/rules.ts#L351)

* `This test closed to new testers on <date/time>.`

**delayedPayLine** — [src/lib/rules.ts:590](../src/lib/rules.ts#L590)

* `<dev>'s payment for your <label> on <title> ($<(cents / 100).toFixed(2)>) is delayed. You'll be told when it arrives.`
* `<dev>'s payment for your <label> on <title> ($<String(cents / 100)>) is delayed. You'll be told when it arrives.`
* `<dev>'s payment for your <label> ($<(cents / 100).toFixed(2)>) is delayed. You'll be told when it arrives.`
* `<dev>'s payment for your <label> ($<String(cents / 100)>) is delayed. You'll be told when it arrives.`

**overHalf** — [src/lib/rules.ts:673](../src/lib/rules.ts#L673)

* `This test was stopped at <time>`
* `This test was stopped on <date/time>`
* `This test ended on <date/time>`

**workOverLine** — [src/lib/rules.ts:696](../src/lib/rules.ts#L696)

* `This test was stopped at <time>, so your <press> didn't go through. Work you sent is still reviewed.`
* `This test was stopped on <date/time>, so your <press> didn't go through. Work you sent is still reviewed.`
* `This test ended on <date/time>, so your <press> didn't go through. Work you sent is still reviewed.`

**stillWorksLine** — [src/lib/rules.ts:703](../src/lib/rules.ts#L703)

* `This test was stopped at <time>, so your <press> didn't go through. You can still <people / items>. Work you sent is still reviewed.`
* `This test was stopped at <time>, so your <press> didn't go through. Work you sent is still reviewed.`
* `This test was stopped at <time>. You can still <people / items>. Work you sent is still reviewed.`
* `This test was stopped at <time>. Work you sent is still reviewed.`
* `This test was stopped on <date/time>, so your <press> didn't go through. You can still <people / items>. Work you sent is still reviewed.`
* `This test was stopped on <date/time>, so your <press> didn't go through. Work you sent is still reviewed.`
* `This test was stopped on <date/time>. You can still <people / items>. Work you sent is still reviewed.`
* `This test was stopped on <date/time>. Work you sent is still reviewed.`
* `This test ended on <date/time>, so your <press> didn't go through. You can still <people / items>. Work you sent is still reviewed.`
* `This test ended on <date/time>, so your <press> didn't go through. Work you sent is still reviewed.`
* `This test ended on <date/time>. You can still <people / items>. Work you sent is still reviewed.`
* `This test ended on <date/time>. Work you sent is still reviewed.`

**cardDeclinedConfirmLine** — [src/lib/rules.ts:850](../src/lib/rules.ts#L850)

* `Your card was declined, so nothing was charged. Change your card and confirm again by <by>.`

**BANK_STAND_IN** — [src/lib/rules.ts:868](../src/lib/rules.ts#L868)

* `Stand-in for your bank's check`

**BANK_STAND_IN_NOTE** — [src/lib/rules.ts:869](../src/lib/rules.ts#L869)

* `Your bank's own page shows here when payments are live. Nothing is charged until it's confirmed.`

**BANK_CHECK_TITLE** — [src/lib/rules.ts:870](../src/lib/rules.ts#L870)

* `Your bank's check`

**BANK_CONFIRMED** — [src/lib/rules.ts:871](../src/lib/rules.ts#L871)

* `Your bank confirmed it: the payment went through.`

**CARD_NOT_VERIFIED** — [src/lib/rules.ts:872](../src/lib/rules.ts#L872)

* `The card wasn't verified. Try again or use another card.`

**bankWaitingLine** — [src/lib/rules.ts:877](../src/lib/rules.ts#L877)

* `Your bank wants you to confirm a $X payment for <what>, made while you were away. Confirm it by <by>.`

**chargebackReversedLine** — [src/lib/rules.ts:924](../src/lib/rules.ts#L924)

* `Your bank's chargeback of $X was reversed: $X refunded to your card.`
* `Your bank's chargeback of $X was reversed: $X taken off what you owe.`

**TEST_LIMIT_LINE** — [src/lib/rules.ts:1047](../src/lib/rules.ts#L1047)

* `You can't join more tests right now.`

**closesInLine** — [src/lib/rules.ts:1137](../src/lib/rules.ts#L1137)

* `⏱ <title> closes to new testers in <items>.`
* `⏱ <title> closes to new testers in <Math.max(m, 1)> minute.`
* `⏱ <title> closes to new testers in <Math.max(m, 1)> minutes.`
* `⏱ Your deadline on <title> is in <items>: send your work before then.`
* `⏱ Your deadline on <title> is in <Math.max(m, 1)> minute: send your work before then.`
* `⏱ Your deadline on <title> is in <Math.max(m, 1)> minutes: send your work before then.`

**RATE_INACTIVE** — [src/lib/rules.ts:1448](../src/lib/rules.ts#L1448)

* `You can rate once your account is active again.`

**RATE_CHARGE_FIRST** — [src/lib/rules.ts:1450](../src/lib/rules.ts#L1450)

* `Charge or let go of your unreviewed work first.`

**RATE_MY_DISPUTE** — [src/lib/rules.ts:1451](../src/lib/rules.ts#L1451)

* `Rating opens once the team decides your dispute.`

**rateOpensOnLine** — [src/lib/rules.ts:1452](../src/lib/rules.ts#L1452)

* `Rating opens on <date>, or sooner if <dev> reviews everything you sent.`

**rateOpensReviewLine** — [src/lib/rules.ts:1454](../src/lib/rules.ts#L1454)

* `Rating opens once <dev> reviews everything you sent.`

**rateTheirDisputeLine** — [src/lib/rules.ts:1456](../src/lib/rules.ts#L1456)

* `Rating opens once the team decides <tester>'s dispute.`

**ratePendingLine** — [src/lib/rules.ts:1458](../src/lib/rules.ts#L1458)

* `You can rate <tester> once they've rated you and everything they sent is settled.`

**stopMomentLine** — [src/lib/rules.ts:1468](../src/lib/rules.ts#L1468)

* `This test closed at <date/time>.`
* `This test was stopped at <date/time>.`
* `The team stopped this test at <date/time>.`
* `You ended <names.tester>'s work early at <date/time>.`
* `You stopped this test at <date/time>.`

**pauseMomentLine** — [src/lib/rules.ts:1480](../src/lib/rules.ts#L1480)

* `This test was paused at <date/time>.`
* `The team paused this test at <date/time>.`
* `Your tests were paused at <date/time>.`
* `Your developer account was suspended at <date/time>.`

**ratingClosedLine** — [src/lib/rules.ts:1520](../src/lib/rules.ts#L1520)

* `Rating closed on <date>.`

**callEndedLine** — [src/lib/rules.ts:1599](../src/lib/rules.ts#L1599)

* `Call ended at <time>.`

**callClosedLineOf** — [src/lib/rules.ts:1618](../src/lib/rules.ts#L1618)

* `This call isn't available.`
* `This test is paused.`
* `This test was stopped.`
* `Your session ended.`
* `You left this test.`
* `They left the test.`
* `Their session ended.`

**noShowLine** — [src/lib/server/adminDaily.ts:46](../src/lib/server/adminDaily.ts#L46)

* `Call report on “<c.contract.title>” by the <c.noShowBy>: “<c.noShowNote>” <process.env.APP_URL>/admin#no-shows`
* `Call report on “<c.contract.title>” by the <c.noShowBy>: “<c.noShowNote>” https://<process.env.VERCEL_PROJECT_PRODUCTION_URL>/admin#no-shows`
* `Call report on “<c.contract.title>” by the <c.noShowBy>: “<c.noShowNote>” <new URL(req.url).origin>/admin#no-shows`
* `Call report on “<c.contract.title>” by the <c.noShowBy>: “<c.noShowNote>” http://localhost:3400/admin#no-shows`

**appClosedLine** — [src/lib/server/blocks.ts:99](../src/lib/server/blocks.ts#L99)

* `“<title>”: your application was closed.`

**blockEndedLine** — [src/lib/server/calls.ts:242](../src/lib/server/calls.ts#L242)

* `Call ended: you blocked <otherName>.`
* `Call ended: the call was cancelled.`

**callLineFor** — [src/lib/server/calls.ts:248](../src/lib/server/calls.ts#L248)

* `This call was cancelled.`
* `Call ended: you blocked <otherName>.`
* `Call ended: the call was cancelled.`
* `Call ended: the $X for calls with <otherName> on this test is reached.`
* `Call ended: it reached 150% of the booked time.`
* `Call ended: this call isn't available.`
* `Call ended: the test is paused.`
* `Call ended: the test was stopped.`
* `Call ended: your session ended.`
* `Call ended: you left this test.`
* `Call ended: they left the test.`
* `Call ended: their session ended.`
* `Call ended at <date/time>.`
* `This call is over.`

**testerRateState** — [src/lib/server/ratings.ts:46](../src/lib/server/ratings.ts#L46)

* `You can rate once your account is active again.`
* `Rating opens once some work was sent or a call took place.`
* `Rating closed on <date/time>.`
* `Charge or let go of your unreviewed work first.`
* `Rating opens once the team decides your dispute.`
* `Rating opens once <person> reviews everything you sent.`
* `Rating opens on <date/time>, or sooner if <person> reviews everything you sent.`

**devRateStates** — [src/lib/server/ratings.ts:74](../src/lib/server/ratings.ts#L74)

* `You can rate once your account is active again.`
* `You can rate <person> once they've rated you and everything they sent is settled.`
* `The 14 days to rate <person> have passed.`
* `Rating opens once the team decides <person>'s dispute.`

**PAYMENT_CHECKING** — [src/lib/server/recovery.ts:21](../src/lib/server/recovery.ts#L21)

* `We didn't hear back from the payment service, so this payment is being checked. Within 15 minutes it shows as paid, or it's back here to pay again. Don't pay it twice: it's never charged twice.`

**kindWords** — [src/lib/server/requests.ts:144](../src/lib/server/requests.ts#L144)

* `daily calls (<r.count> days)`
* `daily calls (<r.count> weeks)`
* `daily calls (until cancelled)`
* `weekly calls (<r.count> days)`
* `weekly calls (<r.count> weeks)`
* `weekly calls (until cancelled)`
* `a call`

**sendClash** — [src/lib/server/requests.ts:150](../src/lib/server/requests.ts#L150)

* `You already have a call with <otherName> at <date/time>.`
* `You already have a request with <otherName> waiting for that time (<date/time>).`

**requestLimitLine** — [src/lib/server/requests.ts:200](../src/lib/server/requests.ts#L200)

* `You already have 3 requests waiting with <tester>. Withdraw one or wait for an answer.`

**bookedLimit** — [src/lib/server/requests.ts:201](../src/lib/server/requests.ts#L201)

* `<testerName> already has 3 booked times with you. Wait until one is over or cancel one.`
* `You already have 3 booked times in this test.`

**refusalFor** — [src/lib/server/requests.ts:226](../src/lib/server/requests.ts#L226)

* `You already withdrew this request.`
* `You already declined this request.`
* `This time was booked at <date/time>.`
* `The call time <date/time> is no longer available.`
* `This request closed: <closing reason>.`
* `This request closed.`

**alreadyRequestedLine** — [src/lib/server/requests.ts:261](../src/lib/server/requests.ts#L261)

* `You already requested this time with <people / items>.`

**NO_CARD_SAVED** — [src/lib/server/stripe.ts:120](../src/lib/server/stripe.ts#L120)

* `No card is saved on this account.`

**PAYMENTS_PROBLEM** — [src/lib/server/stripe.ts:193](../src/lib/server/stripe.ts#L193)

* `Payments are having a problem right now. Nothing was charged; try again shortly.`

**FREE_ENDED_LINE** — [src/lib/server/subscription.ts:381](../src/lib/server/subscription.ts#L381)

* `Free during launch ended: the extras need a subscription now.`

### Common call-clash sentences and client-side refusal reasons

Call-request `clash[0]`, `blocked[0]` and combined lists in section 4 use these exact families; all are F, Alerts always, under Request / Accept (or the inline call-time row). A row-level warning disappears when that row's time/selection no longer conflicts. A refused press follows F lifetime.

* `You already have a call with <person> at <date/time>.`
* `You already have a request with <person> waiting for that time (<date/time>).`
* `<person> already asked for <date/time> (<minutes> min). Accept <their pronoun> request, or pick a time that doesn't overlap.`
* `You already have a call at <date/time> (with <tester>).` (developer)
* `You already have a call at <date/time>.` (tester)
* `<tester> already has a call at <date/time>.` (developer)
* `This time is no longer free.` (tester; no other tester's details)
* `You already have 3 requests waiting with <person>. Withdraw one or wait for an answer.`
* `<tester> already has 3 booked times with you. Wait until one is over or cancel one.` (developer)
* `You already have 3 booked times in this test.` (tester)
* `You have a call with <person> then (<time range>).`
* `Overlaps your call with <person> on <date/time range>.`
* `Overlaps your request to <person> for <date/time range>.`
* `Overlaps <person>'s request for <date/time range>.`
* `Overlaps time <number> in this request (<date/time range>).`

For a later occurrence in a repeating set, the constructor prefixes `The <ordinal> call (<date>) overlaps <rest>` or `The <ordinal> call (<date>): <sentence with its first letter lowercased>`. The first occurrence uses the original sentence. These are red while editing a clashing row; only a refused stale press promotes the same reason to blue.

Sources: [sendClash / acceptClash](../src/lib/server/requests.ts#L147), [availability row constructors](../src/lib/server/requests.ts#L251), and the ceiling constructors in the common index. Call-choice rows can additionally use the red/amber availability row text generated by [callClash.ts](../src/lib/callClash.ts); the same text is promoted to a blue F reason when an old Request/Accept is refused.

The browser can produce a blue reason without an HttpError: `Stripe didn't load.` and `Stripe didn't load. Check your connection and try again.` occur during the fallback bank check, under that payment button; they clear/reset with the check or subsequent local error/reload. [bankConfirm.ts](../src/lib/bankConfirm.ts#L19). The shared JSON handler's 500 reason is `Something went wrong on our side. Try again in a moment.`; the client fallback is `Something went wrong. Try again in a moment.`. These use the pressed button's F wrapper and cannot be disabled through Alerts. [http.ts](../src/lib/server/http.ts#L60), [client.ts](../src/lib/client.ts#L151).


### Local blue errors and the raw-upload exception

| Who / press / where | Exact wording | Trigger / Alerts / how it goes away |
| --- | --- | --- |
| Either side, any API-backed press, under its button | `You seem to be offline. Check your connection and try again.` | fetch failed before a response. Always; next retry/local reset, later page version or reload. [client](../src/lib/client.ts#L104) |
| Developer, Verify a card in chargeback steps | `Card verification isn't set up yet. Contact us in Settings.` | Missing publishable key/client secret in verification response. Always; next verification/reset/reload. [ChargebackSteps](../src/components/ChargebackSteps.tsx#L83) |
| Developer, card form / bank check | `The card wasn't verified. Try again or use another card.` | Fallback if Stripe.js supplied no error message. Provider-supplied `<card-field error>` may appear instead; that text is external. Always; next check/reset/reload. [ChargebackSteps](../src/components/ChargebackSteps.tsx#L100) |
| Tester, screen-recording controls | `Screen sharing was cancelled or blocked by the browser.` | Browser rejected capture. Always; next Start/reset/reload. [ScreenRecorder](../src/components/ScreenRecorder.tsx#L45) |
| Tester, screen-recording controls | `No microphone access, so this recording has no voice.` | Capture continues without microphone; information, not a blocked Upload. Always; next Start/Upload/reset/reload. [ScreenRecorder](../src/components/ScreenRecorder.tsx#L50) |
| Tester, Upload this recording / attachment upload | `The upload didn't finish. Try again.` | Storage PUT non-success without a JSON reason. Always; next upload/reset/reload. [upload](../src/lib/upload.ts#L33) |
| Tester, same upload | `The upload stopped. Check your connection and try again.` | XHR network error. Same location/lifetime. [upload](../src/lib/upload.ts#L37) |
| Tester, same upload | `The upload stopped. Try again.` | XHR abort. Same location/lifetime. [upload](../src/lib/upload.ts#L38) |

ScreenRecorder catches `error.message` directly, whereas RecordingUpload uses `errOf`. Thus the following normally red 400/413 upload errors can appear blue under ScreenRecorder: `Attach an image, a PDF, a text file, a zip or a video.`, `Choose a video file (for example .mp4 or .webm).`, `That file is empty.`, `Recordings can be at most 500 MB.`, `Files can be at most 500 MB.` Shared malformed/oversized JSON can similarly surface `Something went wrong sending that. Reload the page and try again.` or `That's too much to send at once. Try sending less at once.` These are the upload-path exception to the usual status/color rule; they do not become stop-once permission. [recordings](../src/lib/server/recordings.ts#L31), [raw catch](../src/components/ScreenRecorder.tsx#L93), [HTTP parsing](../src/lib/server/http.ts#L21).


## 5. Other blue information notices on pages

These are I notices unless the entry is explicitly a local refusal renderer, in which case it has F lifetime. Alerts does not remove page-state banners. Restrictions, payments and work-over notices disappear only when their state changes or the page is left; the live 20-second beat redraws them using fresh state. Action buttons inside a notice do not make the surrounding informational sentence a stop.

### Live updates, Alerts hints, and retained/refused presses

* Live top box: `Updated · <time>: <change>` (or `Updated: <change>` for a line that already has its time). It reuses sections 1–2's full change list, newest first. Ignored developer categories remain greyed; quiet lines never stop. `Dismiss` hides through the newest displayed time; newer changes appear again. Leaving/reloading resets the page-local feed. A payment's latest state replaces its earlier delayed state by key. Out-of-view arrivals raise `<count> new update ↑/↓` / `<count> new updates ↑/↓`; scrolling the box into view clears the pill and marks its changes seen.
* Open confirmation notices: `Just updated (<time>): <change>` from `LiveNotices`, updated on the same beat. They disappear when that confirmation closes. Updated tags use `Updated <date/time>` or `Updated`; their Before / Now details come from listing/history state, not a separate refusal.
* Developer hint: `You can turn these stops off in Alerts on the test page.` and `Don't stop me for: <category buttons>`. Tester hint: `You can turn these stops off below, or with Alerts at the top of your test's page. New terms from the developer, a key marked as working and what you did in another tab still stop.` Join uses `You can turn these stops off below, or with Alerts on your dashboard.` as its first sentence. The button becomes `Alerts are off` after `Turn off alerts`; the hint is omitted when already Off unless just pressed there.
* `Err`, `ChangesBox.error`, bank error props and admin `msg.text` display the F reasons in section 4. `KeptRefusal` uses the same words once, never a second independent reason. `useGoneOnNewVersion` removes an old under-button reason only after a later version; a redraw bringing the refusal's own state does not instantly erase it. Hard reload has fresh local state.
* `FormMistakes`, `err-field`, error-marked `FieldNote`, monetary caps under inputs, tick-at-least-one validation and red NDA checks are form mistakes rather than this catalog's blue refusals, even when they share a component file.

### State notices and local information, by rendering site

The table includes exact text or the named reusable renderer it delegates to. A condition with `&&` is shown only while true. Inline labels/buttons (such as Dismiss, See it or Continue setup) are controls, not another notice. Repeated source locations are separate placements of the same family.

| Exact wording / renderer payload | Trigger | Who / presses / lifetime | Where |
| --- | --- | --- | --- |
| `<msg>` | `AccountActions`; `msg` | Admin; no press stopped by I / F if an error prop; Alerts never | [src/app/admin/AccountActions.tsx:49](../src/app/admin/AccountActions.tsx#L49) |
| `<msg.text>` | `AdminButton`; `shared check / unconditional` | Admin; no press stopped by I / F if an error prop; Alerts never | [src/app/admin/AdminButton.tsx:115](../src/app/admin/AdminButton.tsx#L115) |
| `Your account is paused. Contact the owner if you think this is a mistake.` | `AdminDevelopersPage`; `adminAccount(user) && !isAdmin(user)` | Admin; no press stopped by I / F if an error prop; Alerts never | [src/app/admin/developers/page.tsx:13](../src/app/admin/developers/page.tsx#L13) |
| `<msg.text>` | `DisputeDecision`; `fin.done` | Admin; no press stopped by I / F if an error prop; Alerts never | [src/app/admin/DisputeDecision.tsx:114](../src/app/admin/DisputeDecision.tsx#L114) |
| `Your account is paused. Contact the owner if you think this is a mistake.` | `AdminPage`; `adminAccount(u) && !isAdmin(u)` | Admin; no press stopped by I / F if an error prop; Alerts never | [src/app/admin/page.tsx:34](../src/app/admin/page.tsx#L34) |
| `<msg.text>` | `LiftApprove`; `shared check / unconditional` | Admin; no press stopped by I / F if an error prop; Alerts never | [src/app/admin/PagedList.tsx:67](../src/app/admin/PagedList.tsx#L67) |
| `<refused>` | `PauseToggle`; `shared check / unconditional` | Admin; no press stopped by I / F if an error prop; Alerts never | [src/app/admin/PagedList.tsx:91](../src/app/admin/PagedList.tsx#L91) |
| `<err>` | `PagedList`; `shared check / unconditional` | Admin; no press stopped by I / F if an error prop; Alerts never | [src/app/admin/PagedList.tsx:513](../src/app/admin/PagedList.tsx#L513) |
| `<err>` | `PreviewButton`; `shared check / unconditional` | Admin; no press stopped by I / F if an error prop; Alerts never | [src/app/admin/PreviewButton.tsx:21](../src/app/admin/PreviewButton.tsx#L21) |
| `<msg.text>` | `TeamCloseBox`; `shared check / unconditional` | Admin; no press stopped by I / F if an error prop; Alerts never | [src/app/admin/TeamCloseBox.tsx:86](../src/app/admin/TeamCloseBox.tsx#L86) |
| `Your account is paused. Contact the owner if you think this is a mistake.` | `AdminTestersPage`; `adminAccount(user) && !isAdmin(user)` | Admin; no press stopped by I / F if an error prop; Alerts never | [src/app/admin/testers/page.tsx:12](../src/app/admin/testers/page.tsx#L12) |
| `<warn>` | `Room`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/app/calls/[id]/CallRoom.tsx:269](../src/app/app/calls/[id]/CallRoom.tsx#L269) |
| `<line>` | `CallRoom`; `line` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/app/calls/[id]/CallRoom.tsx:316](../src/app/app/calls/[id]/CallRoom.tsx#L316) |
| `This call isn't available.` | `CallPage`; `!call \|\| (call.contract.testerId !== u.id && call.contract.test.developerId !== u.id)` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/app/calls/[id]/page.tsx:25](../src/app/app/calls/[id]/page.tsx#L25) |
| `This test changed since you applied. <TermsAgainBox> Join on the current listingWithdraw application <ChangesBox><err>` | `JoinBox`; `p.application?.status === "pending" && p.application.changed && p.mode !== "invite" && !p.invited` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/JoinBox.tsx:193](../src/app/app/find/[id]/JoinBox.tsx#L193) |
| `You asked to rejoin. You'll hear back when the developer answers.`<br>`You applied to join. You'll hear back when the developer answers.` | `JoinBox`; `p.application?.status === "pending" && !p.invited` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/JoinBox.tsx:207](../src/app/app/find/[id]/JoinBox.tsx#L207) |
| `you now meet this test's needs. Press <TESTER_ASK[ask].plain> to <TESTER_ASK[ask].plain>.`<br>`You now meet this test's needs. Press <TESTER_ASK[ask].plain> to <TESTER_ASK[ask].plain>.` | `JoinBox`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/JoinBox.tsx:248](../src/app/app/find/[id]/JoinBox.tsx#L248) |
| `<back.line>Go to your session →` | `JoinWatch`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/JoinWatch.tsx:61](../src/app/app/find/[id]/JoinWatch.tsx#L61) |
| `You rated this test, so you can't join it again.`<br>`You can't join this test again.` | `ListingPage`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/page.tsx:262](../src/app/app/find/[id]/page.tsx#L262) |
| `You were removed from this test. Ask to rejoin: if <person> accepts, your session comes back with everything in it (work you sent, payments and chat), on the current listing.`<br>`You left this test. Ask to rejoin: if <person> accepts, your session comes back with everything in it (work you sent, payments and chat), on the current listing.`<br>`Your work on this test ended. Ask to rejoin: if <person> accepts, your session comes back with everything in it (work you sent, payments and chat), on the current listing.` | `ListingPage`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/page.tsx:263](../src/app/app/find/[id]/page.tsx#L263) |
| `You can't ask to rejoin this test.` | `ListingPage`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/page.tsx:264](../src/app/app/find/[id]/page.tsx#L264) |
| `Your ask to rejoin wasn't accepted.`<br>`Your application to “<test>” wasn't accepted.` | `ListingPage`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/page.tsx:267](../src/app/app/find/[id]/page.tsx#L267) |
| `<test> is full right now. Your invite stays open; we'll tell you when a spot opens.` | `ListingPage`; `isAdmin(u) && t.developerId !== u.id; t.developerId === u.id; !u.isTester; blocked; closed && invite && t.status === "open" && testersIn >= t.spots` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/page.tsx:279](../src/app/app/find/[id]/page.tsx#L279) |
| `This test is paused right now.` | `ListingPage`; `isAdmin(u) && t.developerId !== u.id; t.developerId === u.id; !u.isTester; blocked; closed && invite && t.status === "open" && testersIn >= t.spots; paused` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/page.tsx:281](../src/app/app/find/[id]/page.tsx#L281) |
| `This test was stopped.`<br>`This test is full.`<br>`This test isn't taking new testers any more.` | `ListingPage`; `isAdmin(u) && t.developerId !== u.id; t.developerId === u.id; !u.isTester; blocked; closed && invite && t.status === "open" && testersIn >= t.spots; paused; closed` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/page.tsx:283](../src/app/app/find/[id]/page.tsx#L283) |
| `<g>` | `ListingPage`; `isAdmin(u) && t.developerId !== u.id; t.developerId === u.id; !u.isTester; blocked; closed && invite && t.status === "open" && testersIn >= t.spots; paused; closed` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/find/[id]/page.tsx:285](../src/app/app/find/[id]/page.tsx#L285) |
| `Your <account / developer account> is suspended. To appeal, use Contact us in Settings.`<br>`Your <account / tester account> is paused. To appeal, use Contact us in Settings.`<br>`Your tests are paused after a chargeback. Follow the steps in Payments.`<br>`Your tests are paused until you pay what you owe. Pay what you owe.` | `AppLayout`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/app/layout.tsx:112](../src/app/app/layout.tsx#L112) |
| `<person> invited you to “<test>”. Accept opens the test page. <PausedTag>Sent again on the new listing · <date/time>Full right now: your invite stays openAccept<NoThanks>` | `TesterDashboard`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/app/page.tsx:650](../src/app/app/page.tsx#L650) |
| `Payments aren't set up in this environment yet: Pay presses are recorded as “payments not set up” and nothing is charged.` | `PaymentsPage`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/app/payments/page.tsx:90](../src/app/app/payments/page.tsx#L90) |
| `Reserved $X: it's taken when the team approves lifting your hold.`<br>`Paid. Your tests stay paused until the team approves.` | `PaymentsPage`; `!o.length; cbSteps` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/app/payments/page.tsx:100](../src/app/app/payments/page.tsx#L100) |
| `You've paid what you owe. The team will review your account before your tests resume.` | `PaymentsPage`; `!o.length; cbSteps; review` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/app/payments/page.tsx:100](../src/app/app/payments/page.tsx#L100) |
| `Payments aren't set up in this environment yet: Pay presses are recorded as “payments not set up” and nothing is charged.`<br>`We couldn't save the card. Try again.`<br>`We couldn't open the payout setup. Try again.`<br>`We couldn't verify the card. Try again or use another card.`<br>`Confirm your email first: payouts go only to a confirmed account. We sent you a link.` | `PaymentsPage`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/app/payments/page.tsx:105](../src/app/app/payments/page.tsx#L105) |
| `Stripe still needs a few details before you can be paid. Continue setup below.` | `PaymentsPage`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/app/payments/page.tsx:109](../src/app/app/payments/page.tsx#L109) |
| `The developer gave you a new access key.` | `KeyBox`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/sessions/[id]/KeyBox.tsx:25](../src/app/app/sessions/[id]/KeyBox.tsx#L25) |
| `The developer marked your key as working. If it still fails, you can report it again.` | `KeyBox`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/sessions/[id]/KeyBox.tsx:26](../src/app/app/sessions/[id]/KeyBox.tsx#L26) |
| `<error>` | `KeyBox`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/sessions/[id]/KeyBox.tsx:27](../src/app/app/sessions/[id]/KeyBox.tsx#L27) |
| `This test is paused right now. For now you can <items>. <xs.join("")> comes back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <items>. <xs.join("")> comes back when it resumes.`<br>`This test is paused right now. For now you can <items>. <xs.join("")> come back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <items>. <xs.join("")> come back when it resumes.`<br>`This test is paused right now. For now you can <items>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> comes back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <items>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> comes back when it resumes.`<br>`This test is paused right now. For now you can <items>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> come back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <items>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> come back when it resumes.`<br>`This test is paused right now. For now you can <items>. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <items>.`<br>`This test is paused right now. For now you can <xs[0]> and <xs[1]>. <xs.join("")> comes back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <xs[0]> and <xs[1]>. <xs.join("")> comes back when it resumes.`<br>`This test is paused right now. For now you can <xs[0]> and <xs[1]>. <xs.join("")> come back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <xs[0]> and <xs[1]>. <xs.join("")> come back when it resumes.`<br>`This test is paused right now. For now you can <xs[0]> and <xs[1]>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> comes back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <xs[0]> and <xs[1]>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> comes back when it resumes.`<br>`This test is paused right now. For now you can <xs[0]> and <xs[1]>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> come back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <xs[0]> and <xs[1]>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> come back when it resumes.`<br>`This test is paused right now. For now you can <xs[0]> and <xs[1]>. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <xs[0]> and <xs[1]>.`<br>`This test is paused right now. For now you can <xs.slice(0, -1).join(", ")><oxford ? "," : ""> and <xs[xs.length - 1]>. <xs.join("")> comes back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <xs.slice(0, -1).join(", ")><oxford ? "," : ""> and <xs[xs.length - 1]>. <xs.join("")> comes back when it resumes.`<br>`This test is paused right now. For now you can <xs.slice(0, -1).join(", ")><oxford ? "," : ""> and <xs[xs.length - 1]>. <xs.join("")> come back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <xs.slice(0, -1).join(", ")><oxford ? "," : ""> and <xs[xs.length - 1]>. <xs.join("")> come back when it resumes.`<br>`This test is paused right now. For now you can <xs.slice(0, -1).join(", ")><oxford ? "," : ""> and <xs[xs.length - 1]>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> comes back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <xs.slice(0, -1).join(", ")><oxford ? "," : ""> and <xs[xs.length - 1]>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> comes back when it resumes.`<br>`This test is paused right now. For now you can <xs.slice(0, -1).join(", ")><oxford ? "," : ""> and <xs[xs.length - 1]>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> come back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <xs.slice(0, -1).join(", ")><oxford ? "," : ""> and <xs[xs.length - 1]>. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> come back when it resumes.`<br>`This test is paused right now. For now you can <xs.slice(0, -1).join(", ")><oxford ? "," : ""> and <xs[xs.length - 1]>. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. For now you can <xs.slice(0, -1).join(", ")><oxford ? "," : ""> and <xs[xs.length - 1]>.`<br>`This test is paused right now. <xs.join("")> comes back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. <xs.join("")> comes back when it resumes.`<br>`This test is paused right now. <xs.join("")> come back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. <xs.join("")> come back when it resumes.`<br>`This test is paused right now. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> comes back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> comes back when it resumes.`<br>`This test is paused right now. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> come back when it resumes. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now. <xs.length === 2 ? ′${xs[0]} and ${xs[1]}′ : ′${xs.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${xs[xs.length - 1]}′> come back when it resumes.`<br>`This test is paused right now. Your deadline is paused too: it moves later by however long the pause lasts.`<br>`This test is paused right now.` | `SessionPage`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/sessions/[id]/page.tsx:291](../src/app/app/sessions/[id]/page.tsx#L291) |
| `Your account is paused. You can still dispute a payment.` | `SessionPage`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/sessions/[id]/page.tsx:301](../src/app/app/sessions/[id]/page.tsx#L301) |
| `<work-over first half>[, so your <press> didn't go through]. You can still <available actions>. Work you sent is still reviewed.`<br>`<work-over first half>[, so your <press> didn't go through]. Work you sent is still reviewed.`<br>`Ask to rejoin on the test's page →`<br>`<quoted Stop / End early reason>` | `SessionPage`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/sessions/[id]/page.tsx:302](../src/app/app/sessions/[id]/page.tsx#L302) |
| `<dev> updated the listing: <offer.diff>. Switching applies to work you send from now on; work you've already sent keeps its price. Your deadline never moves earlier. The NDA (changed): switching means you accept it <offer.fromNdaText><offer.ndaText> The questions changed: before and after Before<QuestionList> After<QuestionList> Your answers so far: <items><offer.switchNote> Switch to the new termsKeep my current terms <fin.line><ChangesBox><err>`<br>`<dev> updated the listing: <offer.diff>. Switching applies to work you send from now on; work you've already sent keeps its price. Your deadline never moves earlier. The NDA: switching means you accept it <offer.fromNdaText><offer.ndaText> The questions changed: before and after Before<QuestionList> After<QuestionList> Your answers so far: <items><offer.switchNote> Switch to the new termsKeep my current terms <fin.line><ChangesBox><err>`<br>`<dev> updated the listing: <offer.diff>. Switching applies to work you send from now on; work you've already sent keeps its price. Your deadline never moves earlier. The NDA is removed (changed): switching means you accept it <offer.fromNdaText><offer.ndaText> The questions changed: before and after Before<QuestionList> After<QuestionList> Your answers so far: <items><offer.switchNote> Switch to the new termsKeep my current terms <fin.line><ChangesBox><err>`<br>`<dev> updated the listing: <offer.diff>. Switching applies to work you send from now on; work you've already sent keeps its price. Your deadline never moves earlier. The NDA is removed: switching means you accept it <offer.fromNdaText><offer.ndaText> The questions changed: before and after Before<QuestionList> After<QuestionList> Your answers so far: <items><offer.switchNote> Switch to the new termsKeep my current terms <fin.line><ChangesBox><err>` | `TesterTop`; `shared check / unconditional` | Tester; no press stopped by I / F if an error prop; Alerts never | [src/app/app/sessions/[id]/TesterTop.tsx:83](../src/app/app/sessions/[id]/TesterTop.tsx#L83) |
| `You've changed the <CRITICAL_FIELDS[field]> <LIMITS.criticalChanges> times since testers joined. Contact us in Settings to change it again.` | `TestForm / lockNote`; `fieldLocked(f)` | Developer; no press stopped by I / F if an error prop; Alerts never | [src/app/app/tests/TestForm.tsx:290](../src/app/app/tests/TestForm.tsx#L290) |
| `Started from your unsent draft (<date/time>) · Start empty`<br>`Started from your unsent draft (<date/time>) · Use saved for all`<br>`Started from your unsent draft · Start empty`<br>`Started from your unsent draft · Use saved for all` | `TestForm`; `shared check / unconditional` | Developer; no press stopped by I / F if an error prop; Alerts never | [src/app/app/tests/TestForm.tsx:655](../src/app/app/tests/TestForm.tsx#L655) |
| `<msg>` | `InvitePanel`; `shared check / unconditional` | Developer; no press stopped by I / F if an error prop; Alerts never | [src/app/app/tests/[id]/InvitePanel.tsx:374](../src/app/app/tests/[id]/InvitePanel.tsx#L374) |
| `<l><GapLinesBox><LiveNotices> Invite anywayCancel <ChangesBox>` | `InvitePanel`; `shared check / unconditional` | Developer; no press stopped by I / F if an error prop; Alerts never | [src/app/app/tests/[id]/InvitePanel.tsx:377](../src/app/app/tests/[id]/InvitePanel.tsx#L377) |
| `<bankErr>` | `PayBox`; `shared check / unconditional` | Developer; no press stopped by I / F if an error prop; Alerts never | [src/app/app/tests/[id]/PayBox.tsx:182](../src/app/app/tests/[id]/PayBox.tsx#L182) |
| `<openErr>` | `TopPanel`; `shared check / unconditional` | Developer; no press stopped by I / F if an error prop; Alerts never | [src/app/app/tests/[id]/TopPanel.tsx:170](../src/app/app/tests/[id]/TopPanel.tsx#L170) |
| `Google sign-in was cancelled. Try again, or use an email link.`<br>`That Google sign-in expired or came from another tab. Try again.`<br>`We couldn't finish signing in with Google. Try again, or use an email link.`<br>`Your Google account's email isn't verified, so we can't use it. Use an email link instead.`<br>`Google sign-in isn't available right now. Use an email link.` | `LoginPage`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/login/page.tsx:19](../src/app/login/page.tsx#L19) |
| `This Google sign-up expired. Continue with Google again.` | `GoogleSignupStep`; `!step` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/signup/google/page.tsx:23](../src/app/signup/google/page.tsx#L23) |
| `What changed Version <w.version>, <w.date>: <p>` | `TermsPage`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/app/terms/page.tsx:90](../src/app/terms/page.tsx#L90) |
| `<err>` | `BankWaiting`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/components/BankWaiting.tsx:39](../src/components/BankWaiting.tsx#L39) |
| `<error>` | `CheckPanel`; `error` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/components/CallCheck.tsx:58](../src/components/CallCheck.tsx#L58) |
| `<heading>: <field>: <before> → <after>`<br>`<heading>: <long previous value>; What you typed (not saved): <typed value>` | `FieldNote`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/components/FieldNote.tsx:106](../src/components/FieldNote.tsx#L106) |
| `<heading>: <field>: <saved value>`<br>`<heading>: <field>: empty` | `TheirsNote`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/components/FieldNote.tsx:129](../src/components/FieldNote.tsx#L129) |
| `<heading>: <change line>` | `GroupNote`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/components/FieldNote.tsx:152](../src/components/FieldNote.tsx#L152) |
| `Changed in another tab at <time>: <field> was “<previous value>”`<br>`Changed in another tab at <time>: was “<previous value>”`<br>`Changed in another tab at <time>: <field> was empty`<br>`Changed in another tab at <time>: was empty` | `WasNote`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/components/FieldNote.tsx:172](../src/components/FieldNote.tsx#L172) |
| `<bankNote>` | `OwedBox`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/components/OwedBox.tsx:108](../src/components/OwedBox.tsx#L108) |
| `Still declined: <items>. Your tests stay paused until everything is paid. Update your card and try again.` | `OwedBox`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/components/OwedBox.tsx:111](../src/components/OwedBox.tsx#L111) |
| `<bankErr>` | `PressButton`; `shared check / unconditional` | Both sides / caller of shared check; no press stopped by I / F if an error prop; Alerts never | [src/components/PressButton.tsx:41](../src/components/PressButton.tsx#L41) |

### Blue page strips and bank/call information

All rows here are I: they stop no press themselves, cannot be hidden by Alerts, and remain while their condition holds. Controls end only their own flow. The live beat redraws conditions; it does not expire a persistent banner.

| Who / where | Exact wording | Trigger / how it goes away |
| --- | --- | --- |
| Both sides, app layout | `Email confirmation is off for testing.` | Local testing bypass enabled; absent when disabled, never production. |
| Both sides, app layout | `Confirm your email: we sent a link to <email>. You can still look around, but posting and joining tests require you to confirm.` | Email unverified; confirmation/redraw removes it. Resend the link is the control. |
| Developer, dashboard bank box | `Your bank wants you to confirm (<count>)` | Outstanding bank confirmations; rows disappear on confirmation, expiry or cancellation. |
| Developer, each bank-box row | `$X on “<test>” · <piece> · confirm by <date>, <time>` / `$X for your plan · confirm by <date>, <time>` | Piece / renewal; under 24 hours the day is today or tomorrow and the due part is red. Link: Confirm with your bank →. |
| Developer, Payments confirmation box | `Your bank wants you to confirm` | Same outstanding confirmations, payment-specific text from the bank constructors; disappears when all rows settle/expire. |
| Developer, inline bank check | `Your bank's check` | Stripe supplied a bank URL; under Pay / Pay more / Confirm / Verify. Ends with Confirm/Cancel/return from bank. Bank-provider frame content is external, not app-authored wording. |
| Either caller, setup check | `Allow your camera and microphone in the browser's permission prompt to check them.` | Permission failed during Check your call setup; local error clears when the check is closed/reopened. |
| Either caller, call room | `Sharing their screen` / `You're sharing your screen` | Other/own screen stream active; removed when sharing stops. |
| Either caller, call room | `This call ends at <time>.` | The warning appears during the final two-minute interval and is removed when the call ends. |
| Both sides, Request a time row | `<person> asked for exactly this: Request a time books it.` | Opposite request has the same single time and length. Blue text beneath that row; change/remove the time or book the request to clear. |
| Tester, dashboard answer card | `<dev> offered new terms: <diff>` | Open offer; Switch or keep your terms opens session. Answer/replacement removes/updates it. |
| Tester, dashboard answer card | `<dev> asked for a live call` | Pending developer request; Answer in Live session → opens it. Answer/withdraw/close removes it. |
| Admin, live list pill | `<count> new ↑` | Rows arrived above an open list; revealing them clears its pending/new count. |
| Tester, Join needs popup | `Your <Join / Apply / Ask to rejoin> didn't go through. Check what this test needs now, then press again.` | Requirements/profile changed while a mismatch confirmation was open; the popup lists fresh change lines with See it. It goes on retry/reset/closing the popup. |

Sources: [layout](../src/app/app/layout.tsx#L94), [bankTop](../src/lib/bankTop.ts), [bank box](../src/app/app/BankToConfirm.tsx), [bank check](../src/components/BankCheck.tsx), [call setup](../src/components/CallCheck.tsx), [call warning](../src/lib/callMeasure.ts), [call clash](../src/lib/callClash.ts), [dashboard](../src/app/app/page.tsx#L450), [popup](../src/components/GapDialog.tsx#L68).

Closing-soon constructors such as `⏱ <test> closes to new testers in <time left>.`, `⏱ Your deadline on <test> is in <time left>: send your work before then.`, and `Closes on <date> unless your account is cleared` / `Closes on <date> unless the team lifts the pause` are indexed because the same text is reused across pages and notifications. Their current note/badge styling can be grey or amber rather than a blue info box; they are not stop-once refusals. They disappear when their deadline/state no longer qualifies. [rules](../src/lib/rules.ts#L1137), [pause](../src/lib/pause.ts#L57).


### Edit's blue field notes and draft notice

Developer, Edit/Post, under the relevant field (no Alerts switch; these I notes do not themselves reject a press): `Changed in another tab or device at <time>:`, `Saved in another tab or device at <time>:`, or `Updated at <time>:` heads the associated values. Short values use `<field>: <before> → <after>` with `empty`; long values show `<field>:` then the previous text, and `What you typed (not saved):` with a Copy control. `Use theirs` takes the other saved value. A quiet untouched field says `Changed in another tab at <time>: [<field> ]was “<previous value>”` or `was empty`; it clears when that field is edited or Save is pressed. Typed conflicting values keep their saved-elsewhere note until they match, are taken, or are saved. Access-key notes group `Added: <keys>`, `Removed: <keys>` and key-given changes under the appropriate source/time heading. [editMerge](../src/lib/editMerge.ts), [FieldNote](../src/components/FieldNote.tsx), [TestForm](../src/app/app/tests/TestForm.tsx#L618).

`Started from your unsent draft (<date/time>)` (without the parentheses if no time was kept) shows at the form top after restoring a draft. `Start empty` on Post or `Use saved for all` on Edit resets it; saving/posting or a fresh form clears it. Draft tags themselves are amber, not blue notices. [useKept](../src/lib/useKept.tsx#L207).

### Requested banner families that are red rather than blue

The developer's test-page `TestBanner` is explicitly rose/red (`border-rose-400/50 bg-rose-500/10 text-rose-100`), unlike the blue dashboard restriction box and tester's blue stopped/paused notices. It shows these exact titles at the test-page top, no Alerts option:

* `The team paused this test.`
* `The team stopped this test.`
* `Your tests are paused until you pay what you owe.`
* `Your tests are paused until the chargeback steps are done.`
* `Your account is suspended: your tests are paused.`
* `You stopped this test.`

It can quote `<reason>`, show a named failed press with `: the team paused this test.` / `: the team stopped this test.`, and append `For now you can <stop this test / end testers' work early / cancel calls / rate testers>.` (only available actions, comma-separated with `, or `) or `You can still pay for work testers already sent, chat with them, rate testers, and read their answers[, and start a Next round].` A stopped banner remains as test state; a pause/restriction banner changes when lifted. The failure-name suffix is supplied by `?failed=...`, so reloading that URL can keep the named press; reopening the ordinary URL removes the suffix. The tester's work-over top banner and restricted dashboard use the same URL-based failure-name approach, separate from the component-state/kept refusals that clear on reload. [TestBanner](../src/app/app/tests/[id]/TestBanner.tsx), [client redirects](../src/lib/client.ts#L121).


### Terms page blue What changed box

Both sides and visitors see `What changed`, then `Version 2, Oct 28, 2026:` and these exact bullets. This I box stops no press, has no Alerts setting or Dismiss, and stays on the Terms page until that source/version is changed or the reader leaves it. [termsOfUse](../src/lib/termsOfUse.ts#L26), [Terms page](../src/app/terms/page.tsx#L90).

* `The content rule (section 5) now reads: “Never allowed: sexual content involving minors, illegal content, real-world gore. Other graphic or mature content must be marked Mature (18+), with a reason.”`
* `Payments section rewritten: every money rule is now in one place, section 4, How payments work, in short headed paragraphs with an example each.`
* `A call's length is measured by the app while both people are connected in the call room, up to 150% of the booked length and never past the $1,000 for that tester's calls. The developer pays by the hour at the call's rate; paying less needs a reason the tester reads, and the tester can dispute it once (section 4, Calls).`
* `A live call ends for both people when it reaches 150% of the booked length or its pay would pass what's left of the $1,000 for that tester's calls on the test, and when a block, a pause, a suspension, a leave, End early or a stop happens; the minutes before that are paid as usual (section 4, Calls).`
* `Calls happen in the app's own call room, on the call page, straight between the two browsers (section 7).`
* `When these terms change, you're asked to agree to the new version the next time you post a test, or join, apply, accept an invite or ask to rejoin (section 8).`
* `You must be 18 or older to use Playtest. Signing up (with email or Google) asks you to confirm it (section 1).`
* `To decide a dispute, our team can read the chat between the tester and the developer (section 4, Paying for work).`
* `A piece of work can be paid at most the part's maximum in all, listed or not: $1,000 for written answers or a recording, $200 an hour for a call's measured length. Pay, Pay more and a dispute decision all count toward it (section 4, Pay more).`
* `A listed call the developer hasn't paid 7 days after it took place is charged to their card automatically; there's no Charge or Let it go for it (section 4, Calls).`
* `Emails about payments are always sent the same evening, whatever your email setting, Off included (section 4, Bank checks, declines, holds).`


### Dashboard restriction box: exact lines

Developer-only variants (no Alerts switch; dashboard top; removed when each restriction lifts):

* `Your account is suspended.`
* `Your account is on hold because a payment was declined.`
* `Your account is on hold after a chargeback.`
* `All your tests are paused. Testers stay in them. Your dashboard, Payments, Settings and your notifications stay open. Your test pages show only the overview, where you can stop a test, end testers' work early or cancel booked calls (and answer excerpt requests and disputes); everything else waits, Pay included.`
* `To resume: Pay what you owe in Payments (it opens in a new tab).` Optional: `After you pay, the team will review your account before your tests resume.`
* `To resume: follow the chargeback steps in Payments (it opens in a new tab).` Optional: `Still to do: <steps separated by “, then ”>.`
* `To appeal, contact the team: Contact us in Settings.`
* `When it lifts, your tests resume as normal.`

Tester-side suspension variants (tester reads paused; same location/lifetime):

* `Your account is paused. You were removed from all the tests you were in.`
* `Pay for work already accepted still reaches your Stripe account. What you sent is still reviewed; pay for work accepted while your account is paused reaches it once your account is active again.`
* `Only your dashboard, Payments, Settings and your notifications stay open.`
* `To appeal, contact the team: Contact us in Settings.`
* `When your account is active again, the tests you were removed from wait on your dashboard with Ask to rejoin.`

Heading: `Your account is paused`, `Your account is suspended` or `Your account is on hold`. A just-refused restricted press may precede the list with `<failed press>.` [RestrictedBox](../src/components/RestrictedBox.tsx). These banners explain final restrictions; they do not turn a forbidden press into a second-press success.

### Tester payment-state notices after §97

On Your parts, payment state is a badge: `Paid`, `Payment delayed`, `Waiting for review`, `Not paid (closed on <date>)`, `Rejected`, `Let go`, `Closed by the team`, or `Can't be paid: <dev> deleted their account`. They are not blue notices and stop no press. A bank-waiting, owed or deferred payment takes the delayed badge; unsettled money is excluded from Paid so far / has paid (§82/§88). Task 14 removes `Payment may be delayed.`, `Payment for this part may be delayed.`, `Charged $X. Payment may be delayed until the test resumes.` and `DELAYED_CALL_LINE` from inside these parts, including dispute raises and calls. They can still exist in payment/notification constructors or other pages; deletion of a blue part notice does not delete its payment event. Charge / Let it go's real refusal still uses Err and the kept-refusal rules. Developer payment pages are unchanged.

## Things that look odd

* Section numbers collide: the owner's master already has §93 “The Charge line names the date”; Task 12 explicitly requests another §93 for Rate. This catalog distinguishes them by title/task.
* Several raw error paragraphs (for example AdminButton / AccountActions / BankWaiting) do not use useGoneOnNewVersion. A same-key live redraw need not remove that local state; retry/reset or unmount is what clears it. This differs from Err / ChangesBox's §60 handling.
* The layout's `holdReviewOnly` branch says `You've paid what you owe. Your tests stay paused until the team reviews your account.`, but its enclosing render condition requires `!holdReviewOnly`. That branch cannot currently show (§100 removed this strip); the Payments page still has its own review message.
* The Join gate reads `testerAlertsOff` only to suppress its hint, not to filter the stop list. Its generic tester hint says some stops can be turned off; listing/own Join stops still remain.
* Admin own-change tracking uses x-load, but developer/tester ownChanges still compares body.tab / x-tab. A hard reload changes TAB; same-document navigation can reuse it. Thus the per-page-load distinction in §51 is not uniformly implemented across all three sides.
* Outside Rate, testerGate still counts terms from pageSeenAt and call changes from loadedAt/boxSeenAt, which the client can send older than seenAt. Thus those raw baselines can re-list a call/offer already covered by seenAt, despite §90. Task 12 explicitly normalizes Rate; the remaining shared presses need separate review against that owner rule.
* ScreenRecorder reads error.message directly, so some upload form errors are blue there while RecordingUpload marks the same HTTP 400/413 messages red with errOf. The exception is listed explicitly; a color alone does not prove a stop-once refusal.
* adminRace.whenText uses fmtTime/fmtDateTime without a saved zone, whereas the ChangesBox appends times in the saved zone. Server-worded admin lines can therefore differ from the surrounding client-formatted times.
* The client comment says a kept refusal lasts about 10 seconds, but KEEP_MS is infinity. Its next-press/page-navigation lifetime is the implementation.
* Developer logTestAction still records `rated <tester>`; devChanges with opts.press accepts every own action after §67, so that own Rate can stop a different developer press even though a nearby comment says ratings never form stop lines. Developer Rate itself still ignores other own actions. The live own-action feed is narrower (LIVE_OWN_ACTS), so not every logged own change is necessarily announced there.
* Older comments in testerGate say Rate has its own short list, and older rating comments say ordinary changes never stop tester Rate. Task 12 replaces that behavior; developer Rate retains the narrower list. Comments are not an additional notice.
* `confirmed`, `offered` and `removed` remain accepted developer call kinds although the current request-based flow no longer creates the older Offer/remove-time UI. They are compatibility kinds, not new wording invented here.
* `Payment went through` can be visible in the developer live box without stopping (§78), while a tester's actual received-payment line can stop their press. Same money, different reader/rule.
* A settled payment replaces its delayed update by payment key (§76). Showing both as independent current updates would be a duplicate, not two states owed to the reader.
* Before Task 13, a kept line inside a part's list item counted its own text as “shown elsewhere”, hid, then appeared on the next 200 ms check. The fix removes that self-reference; the host cannot leave an empty bullet.
* Some `HttpError`s protect GET polls, upload transport and call-room signaling. They are present in the source index because the same error machinery handles them, but a read error is not another stop-once press.
* Restriction reason/action text and free-form admin notes can contain arbitrary quoted words. The templates above catalog the app's words; the quoted person-supplied reason is a placeholder, not a finite second list of notices.
