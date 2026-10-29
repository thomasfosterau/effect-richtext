---
"effect-richtext": patch
---

JSON now goes through Effect Schema's JSON codec instead of `JSON.parse` / `JSON.stringify`. Behaviour is unchanged except at one edge: copying a slice whose wrapping nodes carry attributes with no JSON form (a `BigInt`, a cycle) now writes an empty `data-pm-slice` context instead of throwing, so the copy still succeeds without the wrapper context.
