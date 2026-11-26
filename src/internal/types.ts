/**
 * The type with no keys. The type-level folds over node, mark and
 * command maps start from it, and it is the identity of `&`.
 *
 * @internal
 */
// oxlint-disable-next-line effect/avoid-object-type
export type NoKeys = {}
