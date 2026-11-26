---
"@thomasfosterau/effect-richtext": patch
---

`Editor` commands no longer cast away the error channel of the dispatch they receive. A dispatch whose plugins fail now records the failure, skips the command's later dispatches, and fails the command when it finishes, as `StateRef.execute` already does. Before, the failure cut the command short partway through.
