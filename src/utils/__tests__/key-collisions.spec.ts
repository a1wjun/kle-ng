import { describe, it, expect } from 'vitest'
import { Key } from '@adamws/kle-serial'
import {
  DEFAULT_COLLISION_TOLERANCE,
  findKeyCollisions,
  findLayoutCollisions,
  keyBoxes,
  keysCollide,
} from '../key-collisions'

/** A real `Key`, so class defaults match what the app will pass in. */
function makeKey(overrides: Partial<Key> = {}): Key {
  return Object.assign(new Key(), overrides)
}

/** An ISO enter: 1.25×2 body with a 1.5×1 shelf hanging off to the left. */
function isoEnter(x: number, y: number): Key {
  return makeKey({ x, y, width: 1.25, height: 2, x2: -0.25, y2: 0, width2: 1.5, height2: 1 })
}

function labelled(key: Key, index: number, value: string): Key {
  key.labels[index] = value
  return key
}

describe('keyBoxes', () => {
  it('gives a plain key one box at its centre', () => {
    expect(keyBoxes(makeKey({ x: 2, y: 3 }))).toEqual([
      { centerX: 2.5, centerY: 3.5, halfWidth: 0.5, halfHeight: 0.5, angle: 0 },
    ])
  })

  it('gives a non-rectangular key a second box', () => {
    const boxes = keyBoxes(isoEnter(0, 0))

    expect(boxes).toHaveLength(2)
    expect(boxes[1]).toMatchObject({ centerX: 0.5, centerY: 0.5, halfWidth: 0.75, halfHeight: 0.5 })
  })

  it('rotates about the key’s origin, not its centre', () => {
    // 90° about (0, 0) sweeps the key from x∈[0,1] round to x∈[-1,0].
    const [primary] = keyBoxes(makeKey({ rotation_angle: 90, rotation_x: 0, rotation_y: 0 }))

    expect(primary!.centerX).toBeCloseTo(-0.5, 10)
    expect(primary!.centerY).toBeCloseTo(0.5, 10)
  })

  it('honours a position override', () => {
    const [primary] = keyBoxes(makeKey({ x: 0, y: 0 }), 5, 6)

    expect(primary).toMatchObject({ centerX: 5.5, centerY: 6.5 })
  })
})

describe('keysCollide', () => {
  it('does not collide keys laid flush against each other', () => {
    expect(keysCollide(makeKey({ x: 0 }), makeKey({ x: 1 }))).toBe(false)
    expect(keysCollide(makeKey({ y: 0 }), makeKey({ y: 1 }))).toBe(false)
  })

  it('collides keys that genuinely overlap', () => {
    expect(keysCollide(makeKey({ x: 0 }), makeKey({ x: 0.5 }))).toBe(true)
  })

  it('ignores overlap below the tolerance', () => {
    // Authored coordinates and rotation both leave float dust behind; a 0.0002u
    // overlap is noise, not a design error.
    expect(keysCollide(makeKey({ x: 0 }), makeKey({ x: 0.9998 }))).toBe(false)
    expect(DEFAULT_COLLISION_TOLERANCE).toBe(1e-3)
  })

  it('collides through the second rectangle alone', () => {
    // The ISO enter's body spans x∈[0, 1.25]; only its shelf reaches back to
    // -0.25. A neighbour at x∈[-1, 0] touches the body and overlaps the shelf.
    expect(keysCollide(isoEnter(0, 0), makeKey({ x: -1, y: 0 }))).toBe(true)
    // Same neighbour, same place, against a plain key: only touching.
    expect(keysCollide(makeKey({ x: 0, y: 0, width: 1.25, height: 2 }), makeKey({ x: -1 }))).toBe(
      false,
    )
  })

  it('collides a key rotated into its neighbour', () => {
    const still = makeKey({ x: 3, y: 2 })
    const swung = makeKey({ x: 4, y: 2, rotation_angle: 20, rotation_x: 4, rotation_y: 2 })

    expect(keysCollide(still, swung)).toBe(true)
    // Unrotated, the same two keys merely touch.
    expect(keysCollide(still, makeKey({ x: 4, y: 2 }))).toBe(false)
  })

  it('treats an origin at exactly zero as a real origin', () => {
    // Rotating 90° about (0, 0) moves the key to x∈[-1, 0]. Falling back to the
    // key's own centre — the bug in keyToOrientedRectangle — would leave a
    // square exactly where it started and miss this entirely.
    const swung = makeKey({ x: 0, y: 0, rotation_angle: 90, rotation_x: 0, rotation_y: 0 })
    const probe = makeKey({ x: -0.9, y: 0, width: 0.5 })

    expect(keysCollide(swung, probe)).toBe(true)
  })
})

describe('findKeyCollisions', () => {
  const placed = (keys: Key[]) => keys.map((key) => ({ key, x: key.x, y: key.y }))

  it('finds nothing in a normally spaced row', () => {
    const row = [makeKey({ x: 0 }), makeKey({ x: 1 }), makeKey({ x: 2 }), makeKey({ x: 3 })]

    expect(findKeyCollisions(placed(row))).toEqual([])
  })

  it('reports one entry per overlapping pair', () => {
    // A wide key laid across two neighbours: two distinct problems.
    const wide = makeKey({ x: 0.5, width: 2 })
    const collisions = findKeyCollisions(placed([makeKey({ x: 0 }), makeKey({ x: 1 }), wide]))

    expect(collisions).toHaveLength(2)
    expect(collisions.every((c) => c.a === wide || c.b === wide)).toBe(true)
  })

  it('skips keys sharing a matrix coordinate', () => {
    // Same switch annotated twice is validateMatrixDuplicates' problem, not a
    // physical collision.
    const a = labelled(makeKey({ x: 0 }), 0, '1,1')
    const b = labelled(makeKey({ x: 0.5 }), 0, '1,1')

    expect(findKeyCollisions(placed([a, b]))).toEqual([])
    // A different coordinate at the same spot is still a collision.
    expect(findKeyCollisions(placed([a, labelled(makeKey({ x: 0.5 }), 0, '1,2')]))).toHaveLength(1)
  })

  it('respects the placement position over the stored one', () => {
    const stray = makeKey({ x: 20 })
    const overlapping = [
      { key: makeKey({ x: 0 }), x: 0, y: 0 },
      { key: stray, x: 0.5, y: 0 },
    ]

    expect(findKeyCollisions(overlapping)).toHaveLength(1)
  })
})

describe('findLayoutCollisions', () => {
  it('excludes ghost and decal keys', () => {
    const solid = makeKey({ x: 0 })

    expect(findLayoutCollisions([solid, makeKey({ x: 0.5, ghost: true })])).toEqual([])
    expect(findLayoutCollisions([solid, makeKey({ x: 0.5, decal: true })])).toEqual([])
    expect(findLayoutCollisions([solid, makeKey({ x: 0.5 })])).toHaveLength(1)
  })

  it('returns nothing for a layout too small to collide', () => {
    expect(findLayoutCollisions([])).toEqual([])
    expect(findLayoutCollisions([makeKey()])).toEqual([])
  })

  describe('VIA layout options', () => {
    /**
     * Two base keys, plus an option group whose alternative is parked below the
     * board — the way VIA-annotated KLE files are authored. Collapsing moves the
     * alternative onto the choice-0 anchor at x = 2.
     */
    function board(alternativeWidth: number): Key[] {
      return [
        labelled(makeKey({ x: 0, y: 0 }), 0, '0,0'),
        labelled(makeKey({ x: 1, y: 0 }), 0, '0,1'),
        labelled(labelled(makeKey({ x: 2, y: 0 }), 0, '0,2'), 8, '0,0'),
        labelled(labelled(makeKey({ x: 0, y: 3, width: alternativeWidth }), 0, '0,3'), 8, '0,1'),
      ]
    }

    it('does not report an alternative parked beside the layout', () => {
      expect(findLayoutCollisions(board(1))).toEqual([])
    })

    it('reports an overlap that only appears once collapsed', () => {
      // The 2u alternative lands at x∈[2, 4] and runs straight through a base
      // key at x = 3. Nothing overlaps at the authored coordinates, so this is
      // only visible if the checker collapses the layout first.
      const keys = [...board(2), labelled(makeKey({ x: 3, y: 0 }), 0, '0,4')]

      expect(findLayoutCollisions(keys)).toHaveLength(1)
    })

    it('does not report the choice-0 key against its own alternative', () => {
      // They occupy the same space after collapsing, but never at the same time.
      const keys = board(1)
      const collapsedOntoEachOther = findLayoutCollisions(keys)

      expect(collapsedOntoEachOther).toEqual([])
    })
  })

  describe('QMK layout membership', () => {
    it('does not report keys belonging to disjoint layouts', () => {
      // A 2u key and the two 1u keys that replace it, stacked at true positions
      // the way the QMK importer flattens them, tagged into separate layouts.
      const wide = labelled(makeKey({ x: 0, width: 2 }), 9, '0')
      const left = labelled(makeKey({ x: 0 }), 9, '1')
      const right = labelled(makeKey({ x: 1 }), 9, '1')

      expect(findLayoutCollisions([wide, left, right])).toEqual([])
    })

    it('reports keys that share a layout', () => {
      const wide = labelled(makeKey({ x: 0, width: 2 }), 9, '0;1')
      const stray = labelled(makeKey({ x: 1 }), 9, '1')

      expect(findLayoutCollisions([wide, stray])).toHaveLength(1)
    })

    it('always includes untagged shared keys', () => {
      const wide = labelled(makeKey({ x: 0, width: 2 }), 9, '0')
      const shared = makeKey({ x: 1 })

      expect(findLayoutCollisions([wide, shared])).toHaveLength(1)
    })
  })

  it('de-duplicates a pair that collides in more than one variant', () => {
    // Two base keys overlap regardless of which option choice is selected, so
    // they must still be reported exactly once.
    const keys = [
      makeKey({ x: 0, y: 0 }),
      makeKey({ x: 0.5, y: 0 }),
      labelled(makeKey({ x: 5, y: 0 }), 8, '0,0'),
      labelled(makeKey({ x: 5, y: 3 }), 8, '0,1'),
    ]

    expect(findLayoutCollisions(keys)).toHaveLength(1)
  })

  it('does not mutate the layout', () => {
    const keys = [makeKey({ x: 0 }), makeKey({ x: 0.5 })]
    const before = structuredClone(keys)

    findLayoutCollisions(keys)

    expect(keys).toEqual(before)
  })

  it('returns the original key objects, not copies', () => {
    const a = labelled(makeKey({ x: 0, y: 0 }), 8, '0,0')
    const b = makeKey({ x: 0.5, y: 0 })

    const [collision] = findLayoutCollisions([a, b])

    expect([collision!.a, collision!.b]).toContain(a)
    expect([collision!.a, collision!.b]).toContain(b)
  })
})
