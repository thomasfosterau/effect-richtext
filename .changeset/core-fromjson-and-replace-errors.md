---
"@thomasfosterau/effect-richtext": patch
---

`Node.fromJSON` / `DocSchema.nodeFromJSON` no longer re-check attributes their `Schema` has just decoded (roughly 10% faster on attribute-heavy documents). A `ReplaceError` for content that doesn't fit its node again names that content (`Invalid content for node paragraph: <…>`); the compat facade passes the same message through.
