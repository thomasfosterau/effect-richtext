---
"@thomasfosterau/effect-richtext": patch
---

`EditorState.fromJSON` now rejects an array with "Invalid input for EditorState.fromJSON", and `Selection.fromJSON` rejects a non-string `type` with "Invalid input for Selection.fromJSON", instead of failing later with a less specific error.
