---
"@thomasfosterau/effect-richtext": patch
---

Code that used to fail with a `TypeError` on a missing value now checks for it. Commands return `false`, view and DOM helpers skip the step or fall back, and broken invariants throw the layer's own error (`TransformError`, `StepError`, `SelectionError`, `ViewError`, `MarkdownError`, `PositionError`) with a message. A parse rule whose `contentElement` selector matches nothing now parses the whole element.
