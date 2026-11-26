---
"@thomasfosterau/effect-richtext": patch
---

`compat/*` fixes found by running TipTap and ProseKit on the facade: a `Selection` subclass can set `Sub.prototype.visible = false` (as prosemirror-gapcursor does, which failed on import), and commands read state-like objects through their public `doc`, `selection`, `storedMarks` and `tr` (as TipTap's chained commands pass them), instead of silently applying to the original state.
