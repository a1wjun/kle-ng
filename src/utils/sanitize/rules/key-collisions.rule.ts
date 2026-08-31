import { findLayoutCollisions } from '../../key-collisions'
import type { SanitizeRule } from '../types'

/**
 * Two keys wanting the same physical space is a layout that cannot be built —
 * but which of them moves, and where to, is a design decision. So this rule
 * reports and stops there: it is the tool's first warning-only step, and has no
 * `fix`.
 *
 * `findLayoutCollisions` does the work, including excluding ghost and decal keys
 * and checking each multi-layout variant separately so that alternatives which
 * can never be present together are not reported against each other.
 *
 * The count is of *pairs*, not keys: a key overlapping two neighbours is two
 * distinct problems to resolve.
 */
export const keyCollisionsRule: SanitizeRule = {
  id: 'key-collisions',
  kind: 'advisory',
  name: 'Overlapping keys',
  description: 'Keys that physically collide',

  scan(keys) {
    const collisions = findLayoutCollisions(keys)
    return {
      count: collisions.length,
      keys: [...new Set(collisions.flatMap((collision) => [collision.a, collision.b]))],
    }
  },

  // No fix: see above.
}
