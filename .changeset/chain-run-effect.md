---
"@thomasfosterau/effect-richtext": minor
---

`editor.chain()…run` is now an `Effect`, not a function returning one: write `yield* editor.chain().toggleMark("em").run` (no call parentheses). An Effect is already lazy, so the wrapping function added nothing.
