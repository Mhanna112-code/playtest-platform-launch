# Unassign keys without automatically recycling them

Owner clarification: when a tester leaves in any way, the key is unassigned and removed from In use. It is not added to Free. Assignment history remains in Terms history. To reuse the key, the developer explicitly types it into Free; the warning and saved tag name the previous recipient. This supersedes automatic-return behavior in the earlier November 7/8 implementation notes.

Unassigned rows are retained only for history/reuse detection and appear in neither key pool. Rejoining receives a currently free key, without restoring the old one automatically. Manual reuse also consults assignment history if the old free-key row was deleted. Ending through Leave, End early, Stop, blocking, account removal, rating or normal work closure unassigns immediately; legacy inactive assignments are handled on key access/join as before. No automatic spot reduction was added.

No schema migration: key status is already a string. Existing explicit free keys are not bulk-retired because their provenance/manual reuse intent is ambiguous. The current trial's old a was already removed from Free by the owner; its assignment note remains available for the reuse tag.

Validation: 27 focused tests passed across five files, covering departure/history, stop/block/delete, normal closure, rating, new assignment at rejoin, manual reuse including deletion/re-add, preview warnings and other-tab Save behavior. Typecheck/lint passed. Full npm run check reproduced the existing codex8-separate-sides and needs-kind-folds assertions and was stopped; not green. No real payments or emails were triggered.
