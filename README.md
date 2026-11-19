# @thomasfosterau/effect-richtext

The [ProseMirror](https://prosemirror.net) toolkit reimplemented on [Effect](https://effect.website) 4: typed schemas and documents, transforms, editor state and view, commands, history, Markdown/HTML serializers, typed extensions, and a ProseMirror-compatible facade. ProseMirror's own test suites are ported and pass.

> [!CAUTION]
> Experimental and pre-1.0, largely written with Claude Code. The API may change between minor versions.

## Install

```sh
pnpm add @thomasfosterau/effect-richtext effect
```

`effect` (4.x) is a peer dependency. ESM only, with no `.` entry: import modules by subpath.

## Usage

```ts
import { Effect } from "effect"
import { baseKeymap, toggleMark } from "@thomasfosterau/effect-richtext/commands"
import { keymap } from "@thomasfosterau/effect-richtext/keymap"
import { Content, DocSchema } from "@thomasfosterau/effect-richtext/model"
import { EditorState } from "@thomasfosterau/effect-richtext/state"
import { EditorView } from "@thomasfosterau/effect-richtext/view"

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
| `/model`, `/transform`, `/state`, `/view`, `/view-css` | prosemirror-model, -transform, -state, -view (and its stylesheet) |
| `/keymap`, `/commands`, `/history`, `/inputrules` | the matching prosemirror-\* package |
| `/gapcursor`, `/dropcursor`, `/placeholder` | cursors and placeholder decorations |
| `/schema-basic`, `/schema-list`, `/test-builder` | the matching prosemirror-\* package |
| `/markdown`, `/html` | prosemirror-markdown; HTML string helpers |
| `/reactive` | `SubscriptionRef` / `Stream` bindings |
| `/extensions` | typed extensions and chainable commands |
| `/compat/*` | a ProseMirror-compatible facade |

## Documentation

[Guides](https://github.com/thomasfosterau/effect-richtext/tree/trunk/docs) (extensions, compatibility, design); every export has a doc comment. Contributing: [docs/CONTRIBUTING.md](https://github.com/thomasfosterau/effect-richtext/blob/trunk/docs/CONTRIBUTING.md).

## License

MIT; portions derived from ProseMirror, © Marijn Haverbeke and others. See [LICENSE.md](https://github.com/thomasfosterau/effect-richtext/blob/trunk/LICENSE.md).
