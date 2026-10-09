import { describe, expect, test } from '@jest/globals'

import { applySortedDelta, isSortedUnique, sortedIncludes, toSortedUnique } from './sortedList'

/** Replays the ops on a Set, which is the behavior applySortedDelta must match. */
const applyWithSet = (list: string[], ops: { op: 'add' | 'remove'; value: string }[]) => {
  const set = new Set(list)
  ops.forEach(({ op, value }) => (op === 'add' ? set.add(value) : set.delete(value)))
  return [...set].sort()
}

describe('sortedList', () => {
  describe('toSortedUnique', () => {
    test('sorts and drops duplicates without touching the input', () => {
      const input = ['b.com', 'a.com', 'b.com', 'c.com', 'a.com']
      expect(toSortedUnique(input)).toEqual(['a.com', 'b.com', 'c.com'])
      expect(input).toEqual(['b.com', 'a.com', 'b.com', 'c.com', 'a.com'])
    })
    test('handles an empty list', () => {
      expect(toSortedUnique([])).toEqual([])
    })
  })

  describe('isSortedUnique', () => {
    test('accepts empty, single and strictly ascending lists', () => {
      expect(isSortedUnique([])).toBe(true)
      expect(isSortedUnique(['a'])).toBe(true)
      expect(isSortedUnique(['a', 'b', 'c'])).toBe(true)
    })
    test('rejects unsorted lists and duplicates', () => {
      expect(isSortedUnique(['b', 'a'])).toBe(false)
      expect(isSortedUnique(['a', 'a'])).toBe(false)
    })
  })

  describe('sortedIncludes', () => {
    const list = toSortedUnique(['0xabc', 'evil.com', 'phish.io', 'z.org'])

    test('finds every element, including the first and the last', () => {
      list.forEach((value) => expect(sortedIncludes(list, value)).toBe(true))
    })
    test('misses values that are absent, before, between or after the elements', () => {
      ;['', '0x', '0xab', 'evil.co', 'evil.com.', 'zz.org', 'EVIL.COM'].forEach((value) =>
        expect(sortedIncludes(list, value)).toBe(false)
      )
    })
    test('an empty list holds nothing', () => {
      expect(sortedIncludes([], 'evil.com')).toBe(false)
    })
    test('compares the same way the default sort orders, so non-ASCII entries are found', () => {
      const unicodeList = toSortedUnique(['ёvil.com', 'evil.com', 'Evil.com', 'еvil.com', '😈.com'])
      unicodeList.forEach((value) => expect(sortedIncludes(unicodeList, value)).toBe(true))
      // A Cyrillic "е" lookalike is a different entry, not a match for the Latin one
      expect(sortedIncludes(['evil.com'], 'еvil.com')).toBe(false)
    })
  })

  describe('applySortedDelta', () => {
    const list = ['b.com', 'd.com', 'f.com']

    test('adds new values in order, including before the first and after the last', () => {
      expect(
        applySortedDelta(list, [
          { op: 'add', value: 'a.com' },
          { op: 'add', value: 'c.com' },
          { op: 'add', value: 'z.com' }
        ])
      ).toEqual(['a.com', 'b.com', 'c.com', 'd.com', 'f.com', 'z.com'])
    })
    test('adding a value that is already there keeps one copy', () => {
      expect(applySortedDelta(list, [{ op: 'add', value: 'd.com' }])).toEqual(list)
    })
    test('removes values and ignores removing ones that are not there', () => {
      expect(
        applySortedDelta(list, [
          { op: 'remove', value: 'b.com' },
          { op: 'remove', value: 'x.com' }
        ])
      ).toEqual(['d.com', 'f.com'])
    })
    test('the last operation for a value wins, like on a Set', () => {
      expect(
        applySortedDelta(list, [
          { op: 'add', value: 'c.com' },
          { op: 'remove', value: 'c.com' },
          { op: 'remove', value: 'd.com' },
          { op: 'add', value: 'd.com' }
        ])
      ).toEqual(['b.com', 'd.com', 'f.com'])
    })
    test('does not mutate the input list', () => {
      const input = [...list]
      applySortedDelta(input, [
        { op: 'add', value: 'a.com' },
        { op: 'remove', value: 'f.com' }
      ])
      expect(input).toEqual(list)
    })
    test('works on an empty list and with no ops', () => {
      expect(applySortedDelta([], [{ op: 'add', value: 'a.com' }])).toEqual(['a.com'])
      expect(applySortedDelta(list, [])).toEqual(list)
    })
    test('handles a delta with more changes than fit in one concat call', () => {
      const base = Array.from({ length: 30_000 }, (_, i) => `site${String(i).padStart(6, '0')}.com`)
      const ops = base.flatMap((value, i) => {
        if (i % 3 === 0) return [{ op: 'remove' as const, value }]
        if (i % 3 === 1) return [{ op: 'add' as const, value: `${value}-new` }]
        return []
      })
      const result = applySortedDelta(base, ops)

      expect(result).toEqual(applyWithSet(base, ops))
      expect(isSortedUnique(result)).toBe(true)
    })
    test('matches replaying the ops on a Set for random deltas', () => {
      const values = Array.from({ length: 40 }, (_, i) => `site${i}.com`)
      let seed = 42
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648
        return seed / 2147483648
      }
      for (let round = 0; round < 50; round++) {
        const base = toSortedUnique(values.filter(() => random() < 0.5))
        const ops = Array.from({ length: Math.floor(random() * 30) }, () => ({
          op: random() < 0.5 ? ('add' as const) : ('remove' as const),
          value: values[Math.floor(random() * values.length)]!
        }))
        const result = applySortedDelta(base, ops)
        expect(result).toEqual(applyWithSet(base, ops))
        expect(isSortedUnique(result)).toBe(true)
      }
    })
  })
})
