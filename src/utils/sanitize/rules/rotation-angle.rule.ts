import type { Key } from '@adamws/kle-serial'
import { normalizeAngleDegrees, normalizeAngleDegrees360 } from '../../angle-utils'
import type { FixableSanitizeRule } from '../types'

/**
 * A rotation of 3600 degrees puts a key exactly where a rotation of 0 does, and
 * 345 lands where -15 does. The editor's own controls always write the wrapped
 * form, but a hand-edited JSON, a converter or an import can carry anything, and
 * the raw value shows up in exports and in the key properties panel's display.
 *
 * Purely cosmetic on canvas — every consumer goes through cos/sin, which is
 * periodic — which is what makes this a normalization rather than a fix.
 *
 * The manufacturing rotations (`switchRotation`, `stabRotation`) get the same
 * treatment, but wrap onto [0, 360) rather than [-180, 180] — they are stored
 * unsigned, unlike `rotation_angle`. Rotation handling elsewhere (the key
 * properties panel's snap-to-90 behavior) is untouched; this only concerns
 * itself with wrapping whatever value is already stored.
 */
function needsNormalization(key: Key): boolean {
  const angle = key.rotation_angle ?? 0
  const switchRotation = key.switchRotation ?? 0
  const stabRotation = key.stabRotation ?? 0
  return (
    normalizeAngleDegrees(angle) !== angle ||
    normalizeAngleDegrees360(switchRotation) !== switchRotation ||
    normalizeAngleDegrees360(stabRotation) !== stabRotation
  )
}

export const rotationAngleRule: FixableSanitizeRule = {
  id: 'rotation-angle',
  kind: 'normalization',
  name: 'Rotation angles',
  description: 'Wrap angles to their canonical range',

  scan(keys) {
    return { count: keys.filter(needsNormalization).length }
  },

  fix(keys) {
    for (const key of keys) {
      if (!needsNormalization(key)) continue
      key.rotation_angle = normalizeAngleDegrees(key.rotation_angle ?? 0)
      key.switchRotation = normalizeAngleDegrees360(key.switchRotation ?? 0)
      key.stabRotation = normalizeAngleDegrees360(key.stabRotation ?? 0)

      // rotation_x/rotation_y are deliberately untouched. The origin stays
      // correct under wrapping (the key lands in the same place about the same
      // point), and a whole-turn angle that wraps to 0 leaves an origin that the
      // stale-rotation-origin rule already counts as redundant on its own --
      // it reads the wrapped angle too, so this rule creates no work for it.
    }
  },
}
