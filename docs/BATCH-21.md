# Batch 21: the built-in call room replaces Jitsi (owner, Oct 28)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 20 and its recordings.

## 1. Bring in the full app's call room
The full app (C:/Users/march/Projects/playtest-platform) has its own in-app call room: `src/app/call/[slotId]/call-room.tsx` (browser-to-browser WebRTC: camera, microphone, screen share, mute/camera toggles, "polite" negotiation), its page `src/app/call/[slotId]/page.tsx`, the signalling API `src/app/api/call/` (the two pages pass offers/answers/candidates through the app's own server by polling), and `iceServers()` / `callAccess()` in `src/lib/calls.ts` (Google's free STUN servers, plus an optional TURN relay from `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL`). Adapt it into playtest-lite's call page (`/app/calls/[id]`) and data model (Call, CallPresence), keeping playtest-lite's look.
- **Remove Jitsi completely:** `roomUrl`, the "opens in a new tab" line, the host sign-in tips, the Jitsi parts of the 15-minute reminder (keep the reminder itself), and "Check your call setup" becomes an **in-app camera and microphone check** (a small panel that previews your camera and mic level, no call).
- **Who can be in the room:** only the booked tester and the test's developer, only from 10 minutes before the start until the call ends; everyone else (and anyone after it ends) gets "This call isn't available." The server checks on every signalling request, not just page load.

## 2. The server ends calls for real
The room is ended by the server, both sides' pages hang up at once (showing "Call ended: <reason>"), and the room can't be rejoined, when:
- **150% of the booked length** is reached ("Call ended: it reached 150% of the booked time.");
- **the $1,000 for that tester's calls** would be passed (batch 18 §3; the booking cap of batch 18 §6 limits the booked length, but 150% of it can still pass what's left, so this check stays);
- **a block** either way, **a pause** (any cause), **a suspension** of either side, **a leave, End early or Stop**: the call in progress ends at that moment (this replaces batch 18 §9's "keeps counting until both leave": with the in-app room the end is real). The minutes measured up to the end are kept and payable as usual. Calls ahead are cancelled as today.
- Testers' end lines stay neutral ("Call ended: the test is paused."), never "hold" or "suspended".
- A short warning 2 minutes before a planned end (150% or the $1,000): "This call ends at 3:42 PM."

## 3. Measuring from the real connection
The measured length is the time **both browsers were actually connected** (WebRTC connection state "connected"), not page presence: each side reports connect/disconnect to the server; gaps under 5 minutes still count as connected (a reload, a brief drop). Final when both have left, or 30 minutes after the latest allowed end, as today. Keep CallPresence (or replace it) as needed; the Pay box, Charge and close-out keep using "the measured minutes".

## 4. Strict networks
Without a TURN relay, a few calls on strict networks (some offices, some mobile carriers) can't connect directly. The page then says: "Couldn't connect directly (a strict network?). Try another network, or reschedule." and nothing is measured. Add `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` to HANDOVER's optional settings (e.g. a free-tier TURN service) and say what it fixes.

## Check and report
- Tests: access rules; each server-side end (150%, $1,000, block, pause, suspension, leave/End early/Stop) hangs up both and blocks rejoin; measuring from connection events with a short gap; the camera/mic check never creates a call.
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green.
- Migrations only if needed (hand-written, checked with `prisma migrate diff` against playtest_lite_shadow with --exit-code, applied only to the local playtest_lite DB; say the 3400 server needs a restart).
- Don't touch port 3400 or playtest-platform's code (read it only). Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.
