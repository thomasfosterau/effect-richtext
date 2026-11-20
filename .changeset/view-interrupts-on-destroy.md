---
"@thomasfosterau/effect-richtext": patch
---

`EditorView.destroy` (and closing the scope of `EditorView.make`) now interrupts handler and dispatch effects that are still running in the background, instead of letting them run against the destroyed view. An effect interrupted this way is not reported to `onError`.
