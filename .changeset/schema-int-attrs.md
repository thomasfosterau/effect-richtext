---
"@thomasfosterau/effect-richtext": patch
---

Heading `level`, ordered-list `order` and the Markdown schema's equivalents are now declared with `Schema.Int`, so decoding rejects non-integer and non-finite values (`NaN`, `Infinity`) that were previously accepted.
