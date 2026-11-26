---
"@thomasfosterau/effect-richtext": patch
---

`DOMOutputSpec` now includes `string`, as ProseMirror's does. A string renders as a text node wherever a spec is rendered. Before, a string was accepted only at the top level of `renderSpec`, and the default `text` serializer cast its string to fit the type.
