---
"@thomasfosterau/effect-richtext": minor
---

`MarkdownSerializer.serialize` now returns `Effect<string, MarkdownError>`, failing in the error channel when strict mode meets a node or mark type with no serializer, like `MarkdownParser.parse`. The throwing version is now `serializeUnsafe`:

```ts
// before
const text = defaultMarkdownSerializer.serialize(doc)
// after
const text = yield * defaultMarkdownSerializer.serialize(doc)
// or, synchronously
const text = defaultMarkdownSerializer.serializeUnsafe(doc)
```
