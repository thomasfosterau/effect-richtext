---
"@thomasfosterau/effect-richtext": patch
---

Internal invariants that used to fail with a `TypeError` (from a `!` on a missing value) now throw a named `InvariantError` saying what was missing.
