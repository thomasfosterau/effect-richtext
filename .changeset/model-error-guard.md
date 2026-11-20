---
"@thomasfosterau/effect-richtext": patch
---

`isModelError` is now `Schema.is` of the union of the model error classes, so it recognises instances of those classes only. Before, any object whose `_tag` named a model error passed.
