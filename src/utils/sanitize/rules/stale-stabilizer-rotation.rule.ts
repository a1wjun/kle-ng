import type { Key } from '@adamws/kle-serial'
import type { FixableSanitizeRule } from '../types'

/**
 * A stabilizer only exists on a key that is wider or taller than 1u — the plate
 * generator itself only emits a stab cutout past that size (see plate-builder's
 * `stabilizerType !== 'none'` branch). Below that, `stabRotation` is dead weight,
 * same as the key properties panel already treats it: `updateWidth`/`updateHeight`
 * zero it out the moment a key becomes 1u in both dimensions.
 *
 * Both dimensions must be checked, not either: a 1x2 key is 1u *wide* but 2u
 * *tall*, and still needs its stabilizer, so "1u or smaller" has to mean "1u or
 * smaller in both directions", not "1u or smaller in either one".
 */
function hasStaleStabRotation(key: Key): boolean {
  const width = key.width || 1
  const height = key.height || 1
  if (width > 1 || height > 1) return false
  return (key.stabRotation ?? 0) !== 0
}

export const staleStabilizerRotationRule: FixableSanitizeRule = {
  id: 'stale-stabilizer-rotation',
  kind: 'redundancy',
  name: 'Stale stabilizer rotations',
  description: 'Stab rotation on unstabilized keys',

  scan(keys) {
    return { count: keys.filter(hasStaleStabRotation).length }
  },

  fix(keys) {
    for (const key of keys) {
      if (!hasStaleStabRotation(key)) continue
      // Matches the Key class default.
      key.stabRotation = 0
    }
  },
}
