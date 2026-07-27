---
"crosspane": patch
---

Dashboard UI foundation: Tailwind v4 + shadcn-style components (Button/Badge/Input
with cva variants) replace hand-rolled control styles, keeping the same dark look on
the existing palette (now promoted to Tailwind theme tokens). Also fixes monorepo
dev serving a stale bundled dashboard instead of the freshly built one.
