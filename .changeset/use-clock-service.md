---
"@thomasfosterau/effect-richtext": patch
---

`EditorStateConfig.clock` now defaults to Effect's default `Clock` rather than to `Date.now`; both read the same time. The view's input handling also reads timestamps from the state's clock, so a clock you pass in drives its timing checks (such as composition and key timing) as well as `Transaction.time`.
