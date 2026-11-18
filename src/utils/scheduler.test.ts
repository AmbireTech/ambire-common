import { describe, expect, it } from '@jest/globals'

import { forEachInSlices } from './scheduler'

describe('forEachInSlices', () => {
  it('runs over every item once, in order', async () => {
    const seen: number[] = []

    await forEachInSlices([1, 2, 3, 4], (item) => seen.push(item))

    expect(seen).toEqual([1, 2, 3, 4])
  })

  it('does nothing for an empty list', async () => {
    const seen: number[] = []

    await forEachInSlices([], (item: number) => seen.push(item))

    expect(seen).toEqual([])
  })

  it('lets other work run between slices once a slice has spent its budget', async () => {
    const order: string[] = []
    setTimeout(() => order.push('timer'), 0)

    await forEachInSlices([1, 2, 3], (item) => order.push(`item ${item}`), { budgetMs: 0 })

    expect(order).toEqual(['item 1', 'timer', 'item 2', 'item 3'])
  })

  it('does not yield while the slice is within its budget', async () => {
    const order: string[] = []
    const timer = setTimeout(() => order.push('timer'), 0)

    await forEachInSlices([1, 2, 3], (item) => order.push(`item ${item}`), { budgetMs: 60_000 })

    expect(order).toEqual(['item 1', 'item 2', 'item 3'])
    clearTimeout(timer)
  })
})
