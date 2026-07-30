---
'@crosspane/agent': patch
---

Treat a bogus `'undefined'`/`'null'` address as unset

`serverUrl: \`${process.env.NEXT_PUBLIC_CROSSPANE_URL}\`` yields the string `"undefined"`
when the variable isn't set. That parsed as a URL failure and fell through to string
substitution, so the transport tried `undefined/agent` — no scheme, no diagnostic, retrying
forever. It now counts as unset, which means offline capture instead of silent failure.
