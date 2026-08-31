/**
 * Physical collision detection between keys.
 *
 * Two keys collide when the caps they occupy overlap in space. Getting that
 * right takes more than comparing `x`/`y` rectangles:
 *
 * - Keys rotate about an **arbitrary origin**, not their own centre, so a
 *   rotated key's position on the board is not the position stored on it.
 * - ISO and big-ass enter are **two rectangles**, not one. Their bounding box
 *   covers space the key does not occupy, so a naive box test both misses real
 *   overlaps and invents fake ones.
 * - Multi-layout boards deliberately contain keys that overlap on paper but can
 *   never be present at the same time — the ANSI enter and the ISO enter that
 *   replaces it. Checking the flat key array would report every one of them.
 *
 * `findLayoutCollisions` is the entry point that handles all three. The lower
 * layers (`keyBoxes`, `keysCollide`, `findKeyCollisions`) are exposed for
 * callers that already know which keys are simultaneously present.
 *
 * All coordinates are in **layout units**, and all arithmetic is plain `number`
 * — see the note on `orientedBoxesOverlap` about why this path avoids `D`.
 */

import type { Key } from '@adamws/kle-serial'
import { orientedBoxesOverlap, type OrientedBox } from './geometry'
import { isNonRectangular } from './key-utils'
import {
  collapseToLayoutChoicePlacements,
  getLayoutOptionGroups,
  type KeyPlacement,
  type LayoutOptionGroup,
} from './layout-options'
import { collapseToQmkLayout } from './qmk-layout-options'

export type { KeyPlacement } from './layout-options'

/** An unordered pair of keys whose bodies overlap. */
export interface KeyCollision {
  a: Key
  b: Key
}

/**
 * Minimum penetration, in layout units, before an overlap counts.
 *
 * 0.001u is about 0.019mm — far below anything a person would draw on purpose,
 * and comfortably above the float noise that rotation (`cos`/`sin`) and
 * hand-authored coordinates leave behind. Without it, keys laid flush against
 * each other would report as colliding on every shared edge.
 */
export const DEFAULT_COLLISION_TOLERANCE = 1e-3

/**
 * The oriented boxes a key's body occupies — one, or two for a non-rectangular
 * key such as an ISO enter.
 *
 * @param key - The key to measure
 * @param x - Position override, for a key placed somewhere other than where it
 *   is stored (a collapsed alternative layout). Defaults to `key.x`.
 * @param y - As `x`. Defaults to `key.y`.
 */
export function keyBoxes(key: Key, x: number = key.x, y: number = key.y): OrientedBox[] {
  const angle = key.rotation_angle || 0
  // `?? 0`, not a falsy check: an origin at exactly 0 is a real origin, and
  // treating it as "unset" (as keyToOrientedRectangle does) silently rotates the
  // key about its own centre instead.
  const originX = key.rotation_x ?? 0
  const originY = key.rotation_y ?? 0

  const radians = (angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  const boxAt = (left: number, top: number, width: number, height: number): OrientedBox => {
    const centerX = left + width / 2
    const centerY = top + height / 2
    const halfWidth = width / 2
    const halfHeight = height / 2

    if (angle === 0) return { centerX, centerY, halfWidth, halfHeight, angle: 0 }

    const deltaX = centerX - originX
    const deltaY = centerY - originY
    return {
      centerX: originX + deltaX * cos - deltaY * sin,
      centerY: originY + deltaX * sin + deltaY * cos,
      halfWidth,
      halfHeight,
      angle,
    }
  }

  const width = key.width || 1
  const height = key.height || 1
  const boxes = [boxAt(x, y, width, height)]

  if (isNonRectangular(key)) {
    boxes.push(
      boxAt(x + (key.x2 || 0), y + (key.y2 || 0), key.width2 || width, key.height2 || height),
    )
  }

  return boxes
}

/**
 * Whether two keys overlap at the positions stored on them.
 *
 * Keys that merely touch do not collide — see `orientedBoxesOverlap`.
 */
export function keysCollide(a: Key, b: Key, tolerance = DEFAULT_COLLISION_TOLERANCE): boolean {
  return boxesCollide(keyBoxes(a), keyBoxes(b), tolerance)
}

/**
 * Every colliding pair among a set of placements **assumed to be simultaneously
 * present**. Callers on a multi-layout board want `findLayoutCollisions`
 * instead; this one takes the placements at face value.
 *
 * Pairs sharing a matrix coordinate (`labels[0]`) are skipped: those are the
 * same switch annotated twice, which `validateMatrixDuplicates` already reports,
 * not two keys fighting for one hole.
 */
export function findKeyCollisions(
  placements: KeyPlacement[],
  tolerance = DEFAULT_COLLISION_TOLERANCE,
): KeyCollision[] {
  const candidates = placements.map(toCandidate)
  // Sweep along x: sorted by the left edge, a candidate can only touch those
  // still open when it starts, which keeps the common case near-linear instead
  // of testing all n²/2 pairs.
  candidates.sort((left, right) => left.minX - right.minX)

  const collisions: KeyCollision[] = []
  const active: Candidate[] = []

  for (const candidate of candidates) {
    // Drop everything that ended before this one begins.
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.maxX <= candidate.minX) active.splice(i, 1)
    }

    for (const other of active) {
      if (candidate.minY >= other.maxY || other.minY >= candidate.maxY) continue
      if (sharesMatrixPosition(candidate.key, other.key)) continue
      if (boxesCollide(candidate.boxes, other.boxes, tolerance)) {
        collisions.push({ a: other.key, b: candidate.key })
      }
    }

    active.push(candidate)
  }

  return collisions
}

/**
 * Every colliding pair in a layout, accounting for multi-layout alternatives.
 *
 * Each layout variant is checked on its own and the results are unioned, so two
 * keys only ever count as colliding if some real configuration of the board
 * puts both of them on it at once. Ghost and decal keys are excluded — neither
 * is a switch.
 *
 * @param keys - The layout (not mutated)
 * @returns Distinct colliding pairs, de-duplicated across variants
 */
export function findLayoutCollisions(
  keys: Key[],
  tolerance = DEFAULT_COLLISION_TOLERANCE,
): KeyCollision[] {
  const switches = keys.filter((key) => !key.ghost && !key.decal)
  if (switches.length < 2) return []

  const indexOf = new Map<Key, number>()
  switches.forEach((key, index) => indexOf.set(key, index))

  const seen = new Set<string>()
  const collisions: KeyCollision[] = []

  for (const variant of layoutVariants(switches)) {
    for (const collision of findKeyCollisions(variant, tolerance)) {
      const a = indexOf.get(collision.a)
      const b = indexOf.get(collision.b)
      if (a === undefined || b === undefined) continue
      const pair = a < b ? `${a}|${b}` : `${b}|${a}`
      if (seen.has(pair)) continue
      seen.add(pair)
      collisions.push(collision)
    }
  }

  return collisions
}

// --- internal helpers ---

interface Candidate {
  key: Key
  boxes: OrientedBox[]
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function toCandidate(placement: KeyPlacement): Candidate {
  const boxes = keyBoxes(placement.key, placement.x, placement.y)

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const box of boxes) {
    const radians = (box.angle * Math.PI) / 180
    const cos = Math.abs(Math.cos(radians))
    const sin = Math.abs(Math.sin(radians))
    const extentX = box.halfWidth * cos + box.halfHeight * sin
    const extentY = box.halfWidth * sin + box.halfHeight * cos

    minX = Math.min(minX, box.centerX - extentX)
    maxX = Math.max(maxX, box.centerX + extentX)
    minY = Math.min(minY, box.centerY - extentY)
    maxY = Math.max(maxY, box.centerY + extentY)
  }

  return { key: placement.key, boxes, minX, maxX, minY, maxY }
}

function boxesCollide(a: OrientedBox[], b: OrientedBox[], tolerance: number): boolean {
  for (const boxA of a) {
    for (const boxB of b) {
      if (orientedBoxesOverlap(boxA, boxB, tolerance)) return true
    }
  }
  return false
}

function sharesMatrixPosition(a: Key, b: Key): boolean {
  const label = a.labels[0]?.trim()
  return !!label && label === b.labels[0]?.trim()
}

const QMK_MEMBERSHIP_PATTERN = /^\d+(;\d+)*$/

/**
 * The QMK layout indices a board declares, read straight from the `labels[9]`
 * membership tags.
 *
 * `getQmkLayouts` would also give the layouts their names, but it needs
 * `_kleng_qmk_data` from the keyboard metadata, and collision detection only
 * ever sees the key array. The indices are all that matter here.
 */
function qmkLayoutIndices(keys: Key[]): number[] {
  const indices = new Set<number>()
  for (const key of keys) {
    const tag = key.labels[9]?.trim()
    if (!tag || !QMK_MEMBERSHIP_PATTERN.test(tag)) continue
    for (const part of tag.split(';')) indices.add(parseInt(part, 10))
  }
  return [...indices].sort((a, b) => a - b)
}

/** Every option group at choice 0, except `option`, which takes `choice`. */
function choicesFor(
  groups: LayoutOptionGroup[],
  option: number,
  choice: number,
): Map<number, number> {
  const map = new Map<number, number>()
  for (const group of groups) {
    map.set(group.option, group.option === option ? choice : 0)
  }
  return map
}

/**
 * The set of layouts to check, one placement array each.
 *
 * VIA alternatives are authored *offset to the side* of the keys they replace
 * and only land on their true location once collapsed (see
 * docs/development/via-layout-collapsing.md), so those variants must be built
 * with the collapse rather than read off the raw coordinates. QMK layouts need
 * no such translation — the importer already flattens every `LAYOUT_*` into an
 * overlapping superset at true positions, so filtering by membership is enough.
 *
 * Variants are enumerated linearly — the default, plus one per non-zero choice
 * with every other group left at 0 — rather than as a cross product of option
 * groups, which would explode on a board with several of them. This mirrors the
 * layout preview (`utils/preview/layout-source.ts`). A collision that only
 * appears when two non-default choices are selected together is therefore not
 * detected; in practice option groups occupy disjoint regions of the board.
 */
function layoutVariants(keys: Key[]): KeyPlacement[][] {
  const qmkIndices = qmkLayoutIndices(keys)
  if (qmkIndices.length > 0) {
    return qmkIndices.map((index) => collapseToQmkLayout(keys, index).map(atStoredPosition))
  }

  const groups = getLayoutOptionGroups(keys)
  if (groups.length > 0) {
    // -1 never matches an option, so this is "every group at choice 0".
    const variants = [collapseToLayoutChoicePlacements(keys, choicesFor(groups, -1, 0))]
    for (const group of groups) {
      for (const choice of group.choices) {
        if (choice === 0) continue
        variants.push(
          collapseToLayoutChoicePlacements(keys, choicesFor(groups, group.option, choice)),
        )
      }
    }
    return variants
  }

  return [keys.map(atStoredPosition)]
}

function atStoredPosition(key: Key): KeyPlacement {
  return { key, x: key.x, y: key.y }
}
