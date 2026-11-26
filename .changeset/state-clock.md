---
"@thomasfosterau/effect-richtext": minor
---

`EditorStateConfig` takes a `clock` (default `Date.now`) that `state.tr` stamps `Transaction.time` from. States derived by `apply` and `reconfigure` keep it, and `reconfigure` and `fromJSON` accept one too. Pass a controllable clock to test time-dependent plugins such as the history's `newGroupDelay` grouping.
