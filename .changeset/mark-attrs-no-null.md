---
"@thomasfosterau/effect-richtext": minor
---

Mark constructors no longer accept `null` for "no attributes": omit the argument, or pass `undefined`. This covers `MarkType.create` / `createUnsafe`, `DocSchema.mark` / `markUnsafe`, and `toggleMark`'s `attrs` parameter, which now defaults to `undefined`. The compat facade keeps ProseMirror's `null` (`MarkType.create(null)`, `Schema.mark(name, null)`, `toggleMark(type, null)`) and maps it to `undefined`.
