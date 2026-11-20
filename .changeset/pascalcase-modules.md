---
"@thomasfosterau/effect-richtext": minor
---

Adopt Effect's module layout. Each module now has a PascalCase subpath, and the package root re-exports each one as a namespace:

```ts
import { EditorState } from "@thomasfosterau/effect-richtext/State"
// or
import { State } from "@thomasfosterau/effect-richtext"
State.EditorState.create({ schema })
```

| 0.2 subpath                                            | New subpath                                           |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `/model`, `/transform`, `/state`, `/view`, `/view-css` | `/Model`, `/Transform`, `/State`, `/View`, `/ViewCss` |
| `/keymap`, `/commands`, `/history`, `/inputrules`      | `/Keymap`, `/Commands`, `/History`, `/InputRules`     |
| `/gapcursor`, `/dropcursor`, `/placeholder`            | `/GapCursor`, `/DropCursor`, `/Placeholder`           |
| `/schema-basic`, `/schema-list`, `/test-builder`       | `/SchemaBasic`, `/SchemaList`, `/TestBuilder`         |
| `/markdown`, `/html`, `/reactive`, `/extensions`       | `/Markdown`, `/Html`, `/Reactive`, `/Extensions`      |

Migration: replace each lowercase subpath in your imports with its PascalCase name. The lowercase subpaths still resolve to the same files in this release, but are deprecated and will be removed in the next breaking release. `GapCursor` and `TestBuilder` register state when imported, so they are only on their own subpaths, not on the root. `compat/*` is unchanged.
