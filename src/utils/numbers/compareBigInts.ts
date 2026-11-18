/** Orders bigints smallest first in `Array.sort`, which would otherwise compare them as text. */
const compareBigInts = (a: bigint, b: bigint): number => {
  if (a < b) return -1
  if (a > b) return 1

  return 0
}

export default compareBigInts
