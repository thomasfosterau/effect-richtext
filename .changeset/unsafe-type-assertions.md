---
"@thomasfosterau/effect-richtext": patch
---

Replace unsafe type assertions with type guards where one can check the value: DOM nodes, shadow roots, mouse and drag events, Safari's composed selection ranges, and DOM output specs. Synthesised key events are now real `KeyboardEvent`s, and `coordsAtPos` fails with a `ViewError`, rather than a `TypeError`, if it meets a non-element where it expects one.
