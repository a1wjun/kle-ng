import type { Key } from '@adamws/kle-serial'
import { D } from '../../decimal-math'
import { normalizeAngleDegrees } from '../../angle-utils'
import { BoundsCalculator } from '../../utils/BoundsCalculator'
import type { FixableSanitizeRule } from '../types'

/**
 * Below this magnitude the layout counts as already normalized.
 *
 * The epsilon is required for idempotency, not decoration. `calculateRotatedKeyBounds`
 * runs corners through cos/sin for rotated keys, so a genuinely-normalized rotated
 * layout comes back at ~1e-7 rather than exactly 0. Rounding alone is not enough
 * either: a bbox at 0.0000005 rounds *up* to 0.000001, so a round-only predicate
 * would shift the layout and could still report an issue on rescan.
 */
const EPSILON = 1e-6

/**
 * Computes the delta that moves the layout's visual bounding box to (0,0).
 *
 * Uses `BoundsCalculator` with `unit = 1` so the result is in KLE units. This is
 * the rotation-aware *visual* box rather than `min(key.x)`, which is what makes
 * rotated keys come out right; translation commutes with rotation, so shifting
 * every key's raw coordinates by a constant shifts the visual box by that same
 * constant.
 */
function computeDelta(keys: Key[]): { dx: number; dy: number } {
  if (keys.length === 0) return { dx: 0, dy: 0 }

  const bounds = new BoundsCalculator(1).calculateBounds(keys)
  return {
    dx: D.round(-bounds.x, 6),
    dy: D.round(-bounds.y, 6),
  }
}

function isNormalized(dx: number, dy: number): boolean {
  return Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON
}

export const coordinateOffsetRule: FixableSanitizeRule = {
  id: 'coordinate-offset',
  kind: 'normalization',
  name: 'Layout position',
  description: 'Move the layout to start at (0,0)',

  scan(keys) {
    const { dx, dy } = computeDelta(keys)
    // A whole-layout operation, so the count is 0 or 1 rather than a tally.
    return { count: isNormalized(dx, dy) ? 0 : 1 }
  },

  fix(keys) {
    const { dx, dy } = computeDelta(keys)
    if (isNormalized(dx, dy)) return

    for (const key of keys) {
      key.x = D.round(D.add(key.x, dx), 6)
      key.y = D.round(D.add(key.y, dy), 6)

      // Only shift the rotation origin on keys that actually rotate.
      //
      // This guard is load-bearing, not an optimization. On an unrotated key
      // rotation_x/rotation_y are 0 (the Key class default); shifting them
      // unconditionally would leave every unrotated key with a nonzero origin and
      // a zero angle -- precisely the stale-rotation-origin rule's predicate. The
      // tool would manufacture the redundancy it exists to remove, masked in the
      // common case only by registry ordering. When the angle is zero the origin
      // has no effect on anything, so leaving it untouched is correct as well as safe.
      //
      // The angle is wrapped for the same reason: a whole turn (360, -720, ...)
      // is just as unrotated as 0, and stale-rotation-origin reads it that way too.
      if (normalizeAngleDegrees(key.rotation_angle ?? 0) !== 0) {
        key.rotation_x = D.round(D.add(key.rotation_x || 0, dx), 6)
        key.rotation_y = D.round(D.add(key.rotation_y || 0, dy), 6)
      }

      // x2/y2/width2/height2 are deliberately untouched: they are offsets relative
      // to the primary rect (ISO/stepped keys), not absolute coordinates.
    }
  },
}
