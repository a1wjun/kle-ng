import { describe, it, expect } from 'vitest'
import type { Key } from '@adamws/kle-serial'
import { SANITIZE_RULES, scanLayout, applySanitizeFixes } from '../index'
import { staleRotationOriginRule } from '../rules/stale-rotation-origin.rule'
import { makeKey } from './fixtures'

/**
 * A layout carrying every issue type at once: offset from the origin, a
 * whitespace-only label, orphaned size/color overrides, a stale rotation origin
 * and an out-of-range rotation angle. Includes both a rotated and an unrotated key.
 *
 * `b` is rotated about its own top-left corner, which swings its lower-left
 * corner into `a` — so this layout also carries one key collision. That is
 * deliberate: it keeps the "a full apply leaves nothing behind" tests honest
 * about the one issue an apply provably *cannot* resolve.
 */
function dirtyLayout(): Key[] {
  const a = makeKey({ x: 3, y: 2, rotation_angle: 0, rotation_x: 1, rotation_y: 1 })
  a.labels[0] = ' '
  a.textSize[4] = 5
  a.textColor[4] = '#ff0000'

  const b = makeKey({ x: 4, y: 2, rotation_angle: 380, rotation_x: 4, rotation_y: 2 })
  b.labels[0] = 'B'

  return [a, b]
}

function countFor(results: ReturnType<typeof scanLayout>, ruleId: string): number {
  const found = results.find((r) => r.ruleId === ruleId)
  if (!found) throw new Error(`no scan result for ${ruleId}`)
  return found.count
}

describe('scanLayout', () => {
  it('returns one summary per registered rule', () => {
    const results = scanLayout(dirtyLayout())

    expect(results).toHaveLength(SANITIZE_RULES.length)
    expect(results.map((r) => r.ruleId)).toEqual(SANITIZE_RULES.map((r) => r.id))
  })

  it('carries each rule’s kind, name and description', () => {
    const results = scanLayout(dirtyLayout())

    for (const [i, rule] of SANITIZE_RULES.entries()) {
      expect(results[i]!.kind).toBe(rule.kind)
      expect(results[i]!.name).toBe(rule.name)
      expect(results[i]!.description).toBe(rule.description)
    }
  })

  it('detects every issue type in a dirty layout', () => {
    const results = scanLayout(dirtyLayout())

    expect(countFor(results, 'coordinate-offset')).toBe(1)
    expect(countFor(results, 'rotation-angle')).toBe(1)
    expect(countFor(results, 'whitespace-label')).toBe(1)
    expect(countFor(results, 'blank-label-text-size')).toBe(1)
    expect(countFor(results, 'blank-label-text-color')).toBe(1)
    expect(countFor(results, 'stale-rotation-origin')).toBe(1)
    expect(countFor(results, 'key-collisions')).toBe(1)
  })

  it('marks only the rules that have a fix as fixable', () => {
    const results = scanLayout(dirtyLayout())

    expect(results.find((r) => r.ruleId === 'key-collisions')!.fixable).toBe(false)
    expect(results.find((r) => r.ruleId === 'whitespace-label')!.fixable).toBe(true)
  })

  it('does not mutate the layout it scans', () => {
    const keys = dirtyLayout()
    const before = structuredClone(keys)

    scanLayout(keys)

    expect(keys).toEqual(before)
  })

  it('reports a clean layout as clean', () => {
    const keys = dirtyLayout()
    applySanitizeFixes(
      keys,
      SANITIZE_RULES.map((r) => r.id),
    )

    // Fixable rules only: a warning rule reports something an apply was never
    // going to touch, so it stays at its count and that is correct.
    expect(
      scanLayout(keys)
        .filter((r) => r.fixable)
        .every((r) => r.count === 0),
    ).toBe(true)
  })
})

describe('applySanitizeFixes', () => {
  it('only applies the rules it is given', () => {
    const keys = dirtyLayout()

    applySanitizeFixes(keys, ['whitespace-label'])
    const results = scanLayout(keys)

    expect(countFor(results, 'whitespace-label')).toBe(0)
    // Everything else is left exactly as it was.
    expect(countFor(results, 'coordinate-offset')).toBe(1)
    expect(countFor(results, 'rotation-angle')).toBe(1)
    expect(countFor(results, 'blank-label-text-size')).toBe(1)
    expect(countFor(results, 'blank-label-text-color')).toBe(1)
    expect(countFor(results, 'stale-rotation-origin')).toBe(1)
  })

  it('ignores unknown rule ids', () => {
    const keys = dirtyLayout()
    const before = structuredClone(keys)

    applySanitizeFixes(keys, ['no-such-rule'])

    expect(keys).toEqual(before)
  })

  it('does nothing when given no rule ids', () => {
    const keys = dirtyLayout()
    const before = structuredClone(keys)

    applySanitizeFixes(keys, [])

    expect(keys).toEqual(before)
  })

  it('coordinate-offset in isolation does not create stale rotation origins', () => {
    // The registry runs coordinate-offset before stale-rotation-origin, so a
    // "check everything" apply would clean up after a buggy offset rule and hide
    // the problem. This has to run the offset rule alone.
    const keys = [makeKey({ x: 3, y: 3 }), makeKey({ x: 4, y: 3 })]

    applySanitizeFixes(keys, ['coordinate-offset'])

    expect(staleRotationOriginRule.scan(keys).count).toBe(0)
    expect(keys.every((k) => k.rotation_x === 0 && k.rotation_y === 0)).toBe(true)
  })

  it('no rule run on its own raises another rule’s count', () => {
    // Rules are individually selectable, so a rule that only looks correct
    // because a later one cleans up after it is broken for anyone who unchecks
    // that later rule. Registry order must never be load-bearing.
    for (const rule of SANITIZE_RULES) {
      const keys = dirtyLayout()
      const before = scanLayout(keys)

      applySanitizeFixes(keys, [rule.id])

      for (const [i, after] of scanLayout(keys).entries()) {
        if (after.ruleId === rule.id) continue
        expect(
          after.count,
          `${rule.id} raised ${after.ruleId} from ${before[i]!.count} to ${after.count}`,
        ).toBeLessThanOrEqual(before[i]!.count)
      }
    }
  })

  it('is independent of the order rule ids are passed in', () => {
    const forwards = dirtyLayout()
    const backwards = dirtyLayout()

    applySanitizeFixes(forwards, ['coordinate-offset', 'stale-rotation-origin'])
    applySanitizeFixes(backwards, ['stale-rotation-origin', 'coordinate-offset'])

    expect(forwards).toEqual(backwards)
  })

  it('leaves the layout clean for every rule after a full apply', () => {
    const keys = dirtyLayout()

    applySanitizeFixes(
      keys,
      SANITIZE_RULES.map((r) => r.id),
    )

    for (const rule of SANITIZE_RULES) {
      if (!rule.fix) continue // reports only; an apply cannot clear it
      expect(rule.scan(keys).count, `${rule.id} should be clean`).toBe(0)
    }
  })

  it('naming a rule that has no fix changes nothing', () => {
    const keys = dirtyLayout()
    const before = structuredClone(keys)

    applySanitizeFixes(keys, ['key-collisions'])

    expect(keys).toEqual(before)
  })
})

describe('rule registry', () => {
  it('has unique rule ids', () => {
    const ids = SANITIZE_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every rule a kind, name and description', () => {
    for (const rule of SANITIZE_RULES) {
      expect(['redundancy', 'normalization', 'advisory']).toContain(rule.kind)
      expect(rule.name.length).toBeGreaterThan(0)
      expect(rule.description.length).toBeGreaterThan(0)
    }
  })

  it('gives every advisory rule no fix', () => {
    // The panel renders an advisory rule without a checkbox and never selects
    // it, so one that carried a fix would be silently unreachable.
    for (const rule of SANITIZE_RULES) {
      if (rule.kind !== 'advisory') continue
      expect(rule.fix, `${rule.id} is advisory but has a fix`).toBeUndefined()
    }
  })

  it('keeps names and descriptions short enough to stay on one line', () => {
    // The panel renders each rule as a name line plus a compact description line
    // and is sized so it never scrolls. A long string would either ellipsize —
    // hiding the very text it was added to show — or push the panel past the
    // window. These caps are what the 440px panel fits at its font sizes.
    for (const rule of SANITIZE_RULES) {
      expect(rule.name.length, `${rule.id} name is too long for one line`).toBeLessThanOrEqual(28)
      expect(
        rule.description.length,
        `${rule.id} description is too long for one line`,
      ).toBeLessThanOrEqual(38)
    }
  })
})
