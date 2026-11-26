---
"@thomasfosterau/effect-richtext": patch
---

`Mark.sameSet` (core and compat) and `DocSchema.make` / `makeUnsafe` now declare `this: void`. They can be passed around unbound, as `Model.make` already does.
