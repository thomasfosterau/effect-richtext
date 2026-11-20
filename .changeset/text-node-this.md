---
"@thomasfosterau/effect-richtext": patch
---

`DocSchema.text` / `textUnsafe` now return a `TextNode` typed by the schema they are called on (`TextNode<this>`), so generic code holding a schema `Sc` gets a `Node<Sc>` without a cast. Concrete schemas see the same type as before.
