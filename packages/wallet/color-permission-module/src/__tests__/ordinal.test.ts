import { describe, expect, it } from '@jest/globals'
import { ordinal } from '../ordinal.js'

describe('ordinal', () => {
  it('orders exactly as the default sort, ties included', () => {
    const items = ['0f', 'a0', '0F', 'ff', '00', 'a0', '1', '10', '', 'é', 'e', 'Z', 'a']
    expect([...items].sort(ordinal)).toEqual([...items].sort())
  })

  it('returns -1, 0 or 1 by code unit', () => {
    expect(ordinal('0a', '0b')).toBe(-1)
    expect(ordinal('0b', '0a')).toBe(1)
    expect(ordinal('ab', 'ab')).toBe(0)
  })
})
