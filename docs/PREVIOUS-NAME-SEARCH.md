# Private previous-name search (November 7)

The owner approved matching previous names only for people who have already worked together, in Find tests' developer search, Invite testers and the Testers search on the developer's test page. Current names remain the display names. An old-name search shows `Current name · previously Old name`.

“Worked together” uses the existing shared developer/tester contract rule (a join, including a past/left/ended contract), not an invite or application. A teammate tester on someone else's test is not a counterpart. Blocking either way and deleted accounts exclude name history. The admin directory and public profiles gain no alias list.

Profile renames already have account ActionLog records. Search now reads only the name-change records of permitted counterparts; it does not query email history. Regular profile renames record the previous/current name in the same transaction as the change, under the user lock, so concurrent renames keep the actual previous name. No schema migration is needed. Existing valid records are usable; older unrecorded names cannot be reconstructed.

Invite and Find matching preserve the existing short-query and exact-match rules. The roster filters in place and shows the matched prior name beside the current name. Old-name metadata is sent only to the developer entitled to see those testers' history; unrelated viewers never get it.

Tests: `tests/previous-name-search.test.ts` covers counterpart versus unrelated developer/tester, multiple renames, blocking, matching in Find/Invite and the roster's matched-name label. Existing invite-ranking tests remain unchanged.
