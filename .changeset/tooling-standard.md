---
"effect-richtext": minor
---

Ship the package from `dist/`: every subpath entry (`effect-richtext/model`, `/state`, `/view`, …, `/compat/*`) now resolves to built ESM plus declarations, and the unused `.` entry (there was no `src/index.ts`) is gone. The public error classes (`PositionError`, `ReplaceError`, `StepError`, `StateError`, `ViewError`, `KeymapError`, `MarkdownError`, `MissingDocumentError`, …) are now `Schema.TaggedError` classes with the same tags and `message` field. `EditorView<S, never, never>` is assignable to `EditorView<S, any, any>` again under TypeScript 7.
