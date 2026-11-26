---
"@thomasfosterau/effect-richtext": patch
---

Internals of the commands, history, drop cursor, placeholder, input rules, state, Markdown and extensions modules use `Option` instead of `null` or `undefined`. The history state's `@internal` `prevRanges` is now an `Option`.
