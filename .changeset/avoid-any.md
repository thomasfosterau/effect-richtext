---
"@thomasfosterau/effect-richtext": patch
---

Replace the core's `as any` casts with typed code. `ParseRule.skip` now also accepts a DOM node, which the view already passed to parse that node's content instead.
