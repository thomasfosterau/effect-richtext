---
"effect-richtext": patch
---

Recognise functions with `Predicate.isFunction` rather than `instanceof Function` (input-rule attributes, Markdown token `attrs`, plugin props), so a function from another realm (an iframe's) is treated as a function too.
