# NDA-only edits during pauses and after stops

The developer's Edit page shows the NDA section and Save while the test is paused (team pause, payment hold or developer suspension) or stopped. Closed tests keep their existing no-edit rule. Other listing fields and access keys cannot be changed through this exception; the server checks under the test lock. It never reopens participation or changes payment dates.

The NDA editor uses the existing stop-once save checks. A pause or stop after the page opened is listed once, and another tab's NDA save is checked before replacement. Typed text is kept. The full editor stays available on an active test.

NDA changes reach existing and ended participants, with the usual acknowledgement. Existing excerpt rules hide excerpts while an NDA exists and restore otherwise approved excerpts when removed. Acknowledgement does not imply earlier acceptance. No Switch/Keep price offer is created.

Regression tests: `nda-only-paused-stopped.test.ts` covers four restricted states, mixed fields/keys rejected, preserved status and dates, ended-tester acknowledgement, stale saves across pause/stop, and restricted page access. Existing NDA listing and acknowledgement suites are also run.
