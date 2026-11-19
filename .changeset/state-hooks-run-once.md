---
"@thomasfosterau/effect-richtext": patch
---

`EditorState.apply` / `applyTransaction` (and their `Unsafe` twins) now run each plugin hook once per transaction. When a hook returned an Effect, they used to start over on the effectful path and run the hooks before it a second time; they now continue from that hook, as `create` already did. `reconfigureUnsafe` likewise stays synchronous until a hook returns an Effect.
