---
"@thomasfosterau/effect-richtext": patch
---

Speed up complex editing workloads in the core:

- Classes compile their fields as constructor assignments (`useDefineForClassFields: false`), which makes building nodes, fragments, marks, resolved positions and steps cheaper.
- `EditorState.createUnsafe` runs plugin `init` hooks synchronously unless one returns an Effect. Each hook still runs once.
- Attributes whose Schema has no transformation skip the Schema codec in `toJSON`. In `fromJSON` they skip it once the value passes the Schema's guard.
- A keydown that no keymap binds settles without forking a fiber.
