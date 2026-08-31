import { describe, it, expect } from 'vitest'
import { orientedBoxesOverlap, type OrientedBox } from '../geometry'

function box(
  centerX: number,
  centerY: number,
  halfWidth = 0.5,
  halfHeight = 0.5,
  angle = 0,
): OrientedBox {
  return { centerX, centerY, halfWidth, halfHeight, angle }
}

describe('orientedBoxesOverlap', () => {
  it('reports a box overlapping itself', () => {
    expect(orientedBoxesOverlap(box(0, 0), box(0, 0))).toBe(true)
  })

  it('reports genuine penetration', () => {
    expect(orientedBoxesOverlap(box(0, 0), box(0.5, 0))).toBe(true)
  })

  it('does not report boxes that only touch', () => {
    // The whole point: keys sit flush against their neighbours, and a shared
    // edge is not a collision.
    expect(orientedBoxesOverlap(box(0, 0), box(1, 0))).toBe(false)
    expect(orientedBoxesOverlap(box(0, 0), box(0, 1))).toBe(false)
  })

  it('does not report boxes with a gap between them', () => {
    expect(orientedBoxesOverlap(box(0, 0), box(3, 0))).toBe(false)
    expect(orientedBoxesOverlap(box(0, 0), box(0, 3))).toBe(false)
  })

  it('separates a rotated box whose bounding box still overlaps', () => {
    // A 45° square at (0.9, 0.9) has an AABB spanning 0.193..1.607 on both
    // axes, which overlaps the unit square at the origin. The boxes themselves
    // do not touch — this is the case an AABB test gets wrong.
    expect(orientedBoxesOverlap(box(0, 0), box(0.9, 0.9, 0.5, 0.5, 45))).toBe(false)
  })

  it('reports a rotated box that genuinely reaches in', () => {
    // Same diamond, moved close enough to swallow the unit square's corner.
    expect(orientedBoxesOverlap(box(0, 0), box(0.6, 0.6, 0.5, 0.5, 45))).toBe(true)
  })

  it('is symmetric in its arguments', () => {
    const a = box(0, 0)
    const b = box(0.6, 0.6, 0.5, 0.5, 45)

    expect(orientedBoxesOverlap(a, b)).toBe(orientedBoxesOverlap(b, a))
  })

  it('treats a whole turn as no rotation', () => {
    expect(orientedBoxesOverlap(box(0, 0), box(1, 0, 0.5, 0.5, 360))).toBe(false)
    expect(orientedBoxesOverlap(box(0, 0), box(0.5, 0, 0.5, 0.5, 360))).toBe(true)
  })

  describe('tolerance', () => {
    it('ignores penetration at or below it', () => {
      // Boxes 0.9995 apart overlap by 0.0005.
      expect(orientedBoxesOverlap(box(0, 0), box(0.9995, 0), 0.001)).toBe(false)
    })

    it('reports penetration above it', () => {
      // Boxes 0.998 apart overlap by 0.002.
      expect(orientedBoxesOverlap(box(0, 0), box(0.998, 0), 0.001)).toBe(true)
    })

    it('defaults to zero, where only a shared edge is excluded', () => {
      expect(orientedBoxesOverlap(box(0, 0), box(0.9995, 0))).toBe(true)
      expect(orientedBoxesOverlap(box(0, 0), box(1, 0))).toBe(false)
    })
  })
})
