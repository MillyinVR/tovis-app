// lib/typed is the only place in production code where type assertions that
// escape the type system are allowed (enforced by
// tools/check-no-type-escape.mjs). Every helper here must be local,
// justified, and backed by runtime validation where the type system cannot
// prove safety.
export { globalRegistry } from './globalRegistry'
export { toPrismaJson } from './prismaJson'
export { toRecord } from './record'
