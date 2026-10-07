import { getAddress, Interface } from 'ethers'

type TransferLog = {
  address: string
  topics: readonly string[]
  data: string
}

export type TransferLogNft = {
  address: string
  tokenId: bigint
  balanceChange: bigint
}

const erc20TransferInterface = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
])
const erc721TransferInterface = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
])

export async function getTransferLogTokens(logs: readonly TransferLog[], accountAddr: string) {
  const tokens: string[] = []
  const accAddr = getAddress(accountAddr)

  logs.forEach((log) => {
    try {
      const parsed = erc20TransferInterface.parseLog({ topics: [...log.topics], data: log.data })
      if (!parsed) return
      const from = getAddress(parsed.args.from)
      const to = getAddress(parsed.args.to)
      if (from !== accAddr && to !== accAddr) return

      tokens.push(log.address)
    } catch {
      // it means it wasn't a transfer log
    }
  })

  return tokens
}

/**
 * Returns the ERC-721 balance changes involving the account. ERC-721 Transfer
 * logs have the token ID in a fourth topic, unlike ERC-20 Transfer logs where
 * the amount is stored in the log data.
 */
export async function getTransferLogNfts(
  logs: readonly TransferLog[],
  accountAddr: string
): Promise<TransferLogNft[]> {
  const accAddr = getAddress(accountAddr)
  const balanceChangesByNft = new Map<string, TransferLogNft>()

  logs.forEach((log) => {
    try {
      if (log.topics.length !== 4) return

      const parsed = erc721TransferInterface.parseLog({ topics: [...log.topics], data: log.data })
      if (!parsed) return

      const from = getAddress(parsed.args.from)
      const to = getAddress(parsed.args.to)
      if (from !== accAddr && to !== accAddr) return

      const address = getAddress(log.address)
      const tokenId: bigint = parsed.args.tokenId
      const key = `${address}:${tokenId.toString()}`
      const previousChange = balanceChangesByNft.get(key)?.balanceChange || 0n
      let balanceChange = previousChange

      if (from === accAddr) balanceChange -= 1n
      if (to === accAddr) balanceChange += 1n

      balanceChangesByNft.set(key, { address, tokenId, balanceChange })
    } catch {
      // it means it wasn't an ERC-721 transfer log
    }
  })

  return Array.from(balanceChangesByNft.values()).filter(
    ({ balanceChange }) => balanceChange !== 0n
  )
}
