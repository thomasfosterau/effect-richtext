---
"@thomasfosterau/effect-richtext": patch
---

Type assertions are justified or removed throughout. `DOMParser` matches elements with the standard `Element.matches` only (no vendor-prefixed fallbacks), and the drop cursor no longer throws when the node beside it renders to a non-element.
