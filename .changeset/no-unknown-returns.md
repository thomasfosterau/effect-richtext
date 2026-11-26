---
"@thomasfosterau/effect-richtext": patch
---

`CommandSignature.signature` now returns `this["Return"]` instead of `unknown`, so the signature's return type is the one the signature declares.
