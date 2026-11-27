---
"@thomasfosterau/effect-richtext": patch
---

`compat/transform`'s `ReplaceStep` now has ProseMirror's static `MAP_BIAS`. Setting it to `-1` keeps an inserting step mapped over an insertion at the same position before that insertion; it reads and writes the core `ReplaceStep.MAP_BIAS`.
