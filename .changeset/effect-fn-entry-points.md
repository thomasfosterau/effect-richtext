---
"@thomasfosterau/effect-richtext": patch
---

`html.serialize`, `html.parse`, `html.parseSlice`, `StateRef.make` and `EditorObserver.make` are now `Effect.fn` functions, so each run opens a tracing span named after the function and adds it to stack traces. Signatures are unchanged.
