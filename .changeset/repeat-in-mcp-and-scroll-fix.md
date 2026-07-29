---
'crosspane': patch
---

Two fixes found by auditing the codebase against its own invariants.

**The MCP tools omitted repeat counts.** A console error coalesced into `×3000 over 10m` showed
in the dashboard but reached a coding agent as a single line, so the agent concluded it happened
once. Two consumers of the same data drew different conclusions, which defeats the reason the
MCP server reads through the same channel the dashboard does. Repeat count and span are now in
the tool output, and session counts add up actual occurrences rather than coalesced entries.

**Autoscroll fought the user on large captures.** The render cap introduced in the previous
release sliced the log list on every render, so the follow-the-tail effect fired on every
re-render instead of only when logs changed — scrolling up to read earlier output got undone by
the next keystroke in the filter box. Measured: three no-op re-renders forced three scrolls;
now zero.
