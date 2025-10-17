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
