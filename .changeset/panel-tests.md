---
'crosspane': patch
---

Cover the dashboard panels with tests. No behaviour change — this closes the largest untested
surface in the project (the three panels were at 0%), including the render-window notice and
the `×N` repeat badge that shipped in the previous two releases without any test.

What the tests pin down: filter controls actually change the list, caps and repeat counts are
stated on screen rather than applied silently, autoscroll stops when the user scrolls up and
resumes on demand, network rows expand to show the full URL, error reason, response headers and
body preview, and a large capture renders bounded DOM rather than freezing.

Dashboard coverage: 73% → 92% statements, 60% → 89% branches.
