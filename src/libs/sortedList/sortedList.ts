/**
 * Helpers for large string lists kept sorted (default JS string order, i.e. UTF-16 code units) and
 * free of duplicates, so membership is a binary search instead of a Set.
 *
 * A Set of a few hundred thousand strings costs extra memory on top of the array it is built from,
 * and building it is the slowest part of loading such a list on a slow device. A sorted array is
 * already in the shape it is stored in, so loading it needs no extra structure at all.
 */

/** Index of the first element that is not smaller than `value`. */
const lowerBound = (sortedList: readonly string[], value: string): number => {
  let low = 0
  let high = sortedList.length

  while (low < high) {
    const middle = (low + high) >>> 1
    if (sortedList[middle]! < value) low = middle + 1
    else high = middle
  }

  return low
}

/** Whether `sortedList` holds `value`. `sortedList` must be sorted and free of duplicates. */
export const sortedIncludes = (sortedList: readonly string[], value: string): boolean => {
  const index = lowerBound(sortedList, value)

  return index < sortedList.length && sortedList[index] === value
}

/** Whether the list is strictly ascending, i.e. sorted and free of duplicates. */
export const isSortedUnique = (list: readonly string[]): boolean => {
  for (let i = 1; i < list.length; i++) {
    if (!(list[i - 1]! < list[i]!)) return false
  }

  return true
}

/** A sorted copy of `values` without duplicates. */
export const toSortedUnique = (values: readonly string[]): string[] => {
  const sorted = [...values].sort()

  return sorted.filter((value, index) => index === 0 || value !== sorted[index - 1])
}

export type SortedListDeltaOp = { op: 'add' | 'remove'; value: string }

/**
 * Applies add/remove operations in the order given and returns a new sorted, duplicate-free list.
 * Equivalent to replaying them on a Set: only the last operation for a value decides whether it
 * ends up in the list. Runs in one linear pass over `sortedList`, so the cost does not depend on
 * how many operations there are.
 */
export const applySortedDelta = (
  sortedList: readonly string[],
  ops: readonly SortedListDeltaOp[]
): string[] => {
  const lastOpByValue = new Map<string, SortedListDeltaOp['op']>()
  ops.forEach(({ op, value }) => lastOpByValue.set(value, op))

  const valuesToAdd = toSortedUnique(
    [...lastOpByValue].filter(([, op]) => op === 'add').map(([value]) => value)
  )
  const valuesToRemove = toSortedUnique(
    [...lastOpByValue].filter(([, op]) => op === 'remove').map(([value]) => value)
  )

  const result: string[] = []
  let addIndex = 0

  sortedList.forEach((value) => {
    while (addIndex < valuesToAdd.length && valuesToAdd[addIndex]! < value) {
      result.push(valuesToAdd[addIndex]!)
      addIndex++
    }
    // Already in the list, so the pending add is a no-op
    if (addIndex < valuesToAdd.length && valuesToAdd[addIndex] === value) addIndex++

    if (!sortedIncludes(valuesToRemove, value)) result.push(value)
  })

  while (addIndex < valuesToAdd.length) {
    result.push(valuesToAdd[addIndex]!)
    addIndex++
  }

  return result
}
