# @thomasfosterau/effect-richtext

The [ProseMirror](https://prosemirror.net) toolkit reimplemented on [Effect](https://effect.website) 4: typed schemas and documents, transforms, editor state and view, commands, history, Markdown/HTML serializers, typed extensions, and a ProseMirror-compatible facade. ProseMirror's own test suites are ported and pass.

> [!CAUTION]
> Experimental and pre-1.0, largely written with Claude Code. The API may change between minor versions.

## Install

```sh
pnpm add @thomasfosterau/effect-richtext effect
```

`effect` (4.x) is a peer dependency. ESM only. As in Effect, each module has a PascalCase subpath (`@thomasfosterau/effect-richtext/Model`) and is re-exported as a namespace from the root (`import { Model } from "@thomasfosterau/effect-richtext"`), except `GapCursor` and `TestBuilder`, which register state on import. The lowercase subpaths of 0.2 (`/model`, `/schema-basic`, …) still resolve, but are deprecated and will be removed in the next breaking release.

## Usage

```ts
import { Effect } from "effect"
import { baseKeymap, toggleMark } from "@thomasfosterau/effect-richtext/Commands"
import { keymap } from "@thomasfosterau/effect-richtext/Keymap"
import { Content, DocSchema } from "@thomasfosterau/effect-richtext/Model"
import { EditorState } from "@thomasfosterau/effect-richtext/State"
import { EditorView } from "@thomasfosterau/effect-richtext/View"

const schema = DocSchema.makeUnsafe({
  nodes: {
    doc: { content: Content.oneOrMore("paragraph") },
    paragraph: { content: Content.zeroOrMore("text"), toDOM: () => ["p", 0] },
    text: {}
  },
  marks: { strong: { toDOM: () => ["strong", 0] } }
})

const mount = Effect.fn("mount")(function* (place: HTMLElement) {
  const state = yield* EditorState.create({
    schema,
    plugins: [keymap({ "Mod-b": toggleMark(schema.marks.strong) }), keymap(baseKeymap)]
  })
  yield* EditorView.make(place, { state }) // destroyed when the scope closes
})

Effect.runFork(Effect.scoped(Effect.andThen(mount(document.body), Effect.never)))
```

## Modules

| Subpath | Ported from / purpose |
| --- | --- |
| `/Model`, `/Transform`, `/State`, `/View`, `/ViewCss` | prosemirror-model, -transform, -state, -view (and its stylesheet) |
| `/Keymap`, `/Commands`, `/History`, `/InputRules` | the matching prosemirror-\* package |
| `/GapCursor`, `/DropCursor`, `/Placeholder` | cursors and placeholder decorations |
| `/SchemaBasic`, `/SchemaList`, `/TestBuilder` | the matching prosemirror-\* package |
| `/Markdown`, `/Html` | prosemirror-markdown; HTML string helpers |
| `/Reactive` | `SubscriptionRef` / `Stream` bindings |
| `/Extensions` | typed extensions and chainable commands |
| `/compat/*` | a ProseMirror-compatible facade (lowercase, like ProseMirror's packages) |

## Documentation

[Guides](https://github.com/thomasfosterau/effect-richtext/tree/trunk/docs) (extensions, compatibility, design); every export has a doc comment. Contributing: [docs/CONTRIBUTING.md](https://github.com/thomasfosterau/effect-richtext/blob/trunk/docs/CONTRIBUTING.md).

## License

MIT; portions derived from ProseMirror, © Marijn Haverbeke and others. See [LICENSE.md](https://github.com/thomasfosterau/effect-richtext/blob/trunk/LICENSE.md).
