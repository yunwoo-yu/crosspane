---
'@crosspane/protocol': minor
'crosspane': minor
---

Signal the end of history replay, so `crosspane mcp` stops answering from a partial one

The hub sends `hello` and then streams history across several frames. A live UI filling in a few
frames late is harmless, but `crosspane mcp` answers a question immediately after connecting, and
between those frames it was answering from **part** of the history — which for a coding agent means
it could say "no errors" when there were some. It surfaced as a CI flake first: one leg saw one of
two events and blocked a release.

The hub now sends `history-complete` once per connection, after the replay, and the MCP server waits
for it before its first answer. The dashboard ignores it; a new consumer that answers questions
right after connecting should wait for it too.

Tests that assert on a frame sequence need to skip it — it is a boundary, not data.
