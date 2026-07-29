---
"crosspane": minor
---

Save a live session to a file from the dashboard. Until now the agent could export a capture and the dashboard could replay one, but there was no way to keep what you were watching — an odd gap for a tool whose main workflow is "reproduce, then hand it to a developer". The hub serves `GET /capture/:id` from its original event history, so a saved file is byte-identical in shape to an agent export and replays through the same code path.
