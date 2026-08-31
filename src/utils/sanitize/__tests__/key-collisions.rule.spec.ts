import { describe, it, expect } from 'vitest'
import { keyCollisionsRule } from '../rules/key-collisions.rule'
import { makeKey } from './fixtures'

describe('keyCollisionsRule', () => {
  it('is an advisory rule with no fix', () => {
    expect(keyCollisionsRule.kind).toBe('advisory')
    expect(keyCollisionsRule.fix).toBeUndefined()
  })

  it('reports nothing for a normally spaced row', () => {
    const row = [makeKey({ x: 0 }), makeKey({ x: 1 }), makeKey({ x: 2 })]

    expect(keyCollisionsRule.scan(row).count).toBe(0)
  })

  it('counts pairs, not keys', () => {
    // One wide key laid across two neighbours is two problems to resolve.
    const keys = [makeKey({ x: 0 }), makeKey({ x: 1 }), makeKey({ x: 0.5, width: 2 })]

    expect(keyCollisionsRule.scan(keys).count).toBe(2)
  })

  it('names the affected keys so the panel can select them', () => {
    const a = makeKey({ x: 0 })
    const b = makeKey({ x: 0.5 })

    const result = keyCollisionsRule.scan([a, b])

    expect(result.keys).toHaveLength(2)
    expect(result.keys).toContain(a)
    expect(result.keys).toContain(b)
  })

  it('lists each affected key once however many pairs it is in', () => {
    const keys = [makeKey({ x: 0 }), makeKey({ x: 1 }), makeKey({ x: 0.5, width: 2 })]

    expect(keyCollisionsRule.scan(keys).keys).toHaveLength(3)
  })

  it('ignores ghost and decal keys', () => {
    const keys = [
      makeKey({ x: 0 }),
      makeKey({ x: 0.5, ghost: true }),
      makeKey({ x: 0.6, decal: true }),
    ]

    expect(keyCollisionsRule.scan(keys).count).toBe(0)
  })

  it('does not mutate the layout it scans', () => {
    const keys = [makeKey({ x: 0 }), makeKey({ x: 0.5 })]
    const before = structuredClone(keys)

    keyCollisionsRule.scan(keys)

    expect(keys).toEqual(before)
  })
})
