# E2 evaluation attempts (cycle-20261014T125204-f7ba8a)

1. Inconclusive: benchmark case `native-macho-runtime` failed on baseline and candidate (measurement invalid).
2. Inconclusive: `native-macho` failed on baseline and candidate: "REA timed out waiting for Hopper bridge readiness" (600 s).
   The same candidate also reported one failing test, `a stale lock is taken over by exactly one of many racing processes`,
   during that run (flaky under load; not reproduced in the accepted run). Running the cases directly with `era analyze` succeeded.
3. Re-run under `caffeinate -dimsu` (machine not asleep): accepted, all guards pass, target met (see report.md).
Inconclusive runs make no decision; the attempts differ only in environment, not in code.
