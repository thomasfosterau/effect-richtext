// Type-level assertion helpers for the `tests/**/*.types.ts` files.

/**
 * True when `A` and `B` are the same type (not merely mutually
 * assignable).
 */
export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** Compiles only when `T` is `true`. */
export type Expect<T extends true> = T
