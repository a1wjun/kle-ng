import type { Key } from '@adamws/kle-serial'
import { normalizeAngleDegrees } from '../../angle-utils'
import type { FixableSanitizeRule } from '../types'

/**
 * A rotation origin only means anything when there is a rotation. Left on a key
 * whose angle is 0, the coordinates are dead weight.
 *
 * The angle is wrapped first, so a whole turn (360, -720, ...) counts as
 * unrotated too — it genuinely is, the origin has no effect at any multiple of
 * 360. Wrapping here also keeps this rule and the rotation-angle rule in
 * agreement: normalizing 360 to 0 cannot turn a key this rule considered clean
 * into a new issue, whichever of the two the user has checked.
 */
function hasStaleOrigin(key: Key): boolean {
  if (normalizeAngleDegrees(key.rotation_angle ?? 0) !== 0) return false
  return (key.rotation_x ?? 0) !== 0 || (key.rotation_y ?? 0) !== 0
}

export const staleRotationOriginRule: FixableSanitizeRule = {
  id: 'stale-rotation-origin',
  kind: 'redundancy',
  name: 'Stale rotation origins',
  description: 'Origins on unrotated keys',

  scan(keys) {
    return { count: keys.filter(hasStaleOrigin).length }
  },

  fix(keys) {
    for (const key of keys) {
      if (!hasStaleOrigin(key)) continue
      // Matches the Key class defaults.
      key.rotation_x = 0
      key.rotation_y = 0
    }
  },
}
