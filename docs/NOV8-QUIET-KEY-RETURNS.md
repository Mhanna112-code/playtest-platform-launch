# Returned access keys move quietly

A key automatically released when a tester leaves or their work ends moves from In use to Free without an Added-in-another-tab notice. The form still merges the current free pool with unsaved local additions/deletions. Genuine developer additions/deletions and assignment warnings keep their notices.

The form remembers keys it saw assigned and passes that display baseline with Save. The server excludes their return from added-key conflict lines too, including a release landing before the next UI poll. Existing clients retain their prior fallback. No schema, assignment, key history or participation rule changes.

Manual baseline: owner confirmed DMTEst leaving releases the key and preserves its Terms history. The old form incorrectly displayed Added for that returned key; the new code separates availability returns from developer edits.

Validation: 13 focused tests passed, including the new server Save classification regression and existing other-tab edit tests. Typecheck and lint passed. Full npm run check reproduced the existing codex8-separate-sides and needs-kind-folds source assertions and was stopped; it is not green.
