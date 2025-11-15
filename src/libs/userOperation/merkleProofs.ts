import { keccak256, solidityPacked } from 'ethers'

const sortHexes = (hexes: string[]) => {
  return hexes.sort((x, y) => {
    const a = BigInt(x)
    const b = BigInt(y)
    if (a > b) return 1
    if (a === b) return 0
    return -1
  })
}

export const getMerkleRoot = (validAfter: number, validUntil: number, userOpHashes: string[]) => {
  const leafs = userOpHashes.map((userOpHash) =>
    keccak256(solidityPacked(['uint48', 'uint48', 'bytes32'], [validUntil, validAfter, userOpHash]))
  )

  let levelItems = leafs

  while (levelItems.length > 1) {
    const nextLevelItems: string[] = []

    for (let i = 0; i < levelItems.length; i += 2) {
      const left = levelItems[i]
      const right = i + 1 < levelItems.length ? levelItems[i + 1] : left // duplicate last if odd
      const combined = solidityPacked(['bytes32', 'bytes32'], sortHexes([left, right]))
      nextLevelItems.push(keccak256(combined))
    }

    levelItems = nextLevelItems
  }

  return levelItems[0]
}

/**
 * Compute Merkle proof for a given leaf within a list of leaves.
 *
 * @param leaf - The target leaf (as a hex string)
 * @param leaves - All leaves (as hex strings, unsorted)
 * @returns Array of sibling hashes (the Merkle proof)
 */
export function getMerkleProof(
  validAfter: number,
  validUntil: number,
  userOpHash: string,
  userOpHashes: string[]
): string[] {
  const leaf = keccak256(
    solidityPacked(['uint48', 'uint48', 'bytes32'], [validUntil, validAfter, userOpHash])
  )
  const leafs = userOpHashes.map((userOpHash) =>
    keccak256(solidityPacked(['uint48', 'uint48', 'bytes32'], [validUntil, validAfter, userOpHash]))
  )

  let level = leafs

  const proof: string[] = []

  let index = level.findIndex((l) => l === leaf)

  // Build the tree and collect sibling hashes
  while (level.length > 1) {
    const nextLevel: string[] = []

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]
      const right = i + 1 < level.length ? level[i + 1] : left

      const pair = solidityPacked(['bytes32', 'bytes32'], sortHexes([left, right]))
      const parent = keccak256(pair)

      if (i === index || i + 1 === index) {
        const sibling = i === index ? right : left
        if (sibling !== left || sibling !== right) {
          proof.push(sibling)
        }
        index = Math.floor(i / 2)
      }

      nextLevel.push(parent)
    }

    level = nextLevel
  }

  return proof
}
