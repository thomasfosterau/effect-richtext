---
"@thomasfosterau/effect-richtext": patch
---

The view's `editable` prop is read as the boolean its type declares: any falsy result makes the view read-only, where before only `false` did. The compat facade keeps ProseMirror's rule (only `false` is "not editable"). Pasted-text transforms, command results and decoration attributes are likewise passed through without re-coercion.
