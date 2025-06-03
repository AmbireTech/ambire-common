import { getAddress, Interface, Log } from 'ethers'

export async function getTransferLogTokens(logs: readonly Log[], accountAddr: string) {
  const abi = ['event Transfer(address indexed from, address indexed to, uint256 value)']
  const iface = new Interface(abi)
  const tokens: string[] = []
  const accAddr = getAddress(accountAddr)

  logs.forEach((log) => {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data })
      if (!parsed) return
      const from = getAddress(parsed.args.from)
      const to = getAddress(parsed.args.to)
      if (from !== accAddr && to !== accAddr) return

      tokens.push(log.address)
    } catch (e) {
      // it means it wasn't a transfer log
    }
  })

  return tokens
}
