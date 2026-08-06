import gasTankFeeTokens from '../../consts/gasTankFeeTokens'

// Same value as ethers' ZeroAddress, defined locally so this module stays free
// of ethers — it is reachable from an offloaded task, and a worklet runtime
// cannot load ethers. See src/libs/offload/README.md.
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// USDC.e is returned with the symbol "USDC" by the deployless BalanceGetter;
// override it back so the asset the relayer tracks as USDC.e is not confused
// with native USDC on the same chain.
const usdcEMapping: { [key: string]: string } = {
  '43114': '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664',
  '1285': '0x748134b5f553f2bcbd78c6826de99a70274bdeb3',
  '42161': '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  '137': '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  '10': '0x7f5c764cbc14f9669b88837ca1490cca17c31607'
}

export function overrideSymbol(address: string, chainId: bigint, symbol: string) {
  // Since deployless lib calls contract and USDC.e is returned as USDC, we need to override the symbol
  if (
    usdcEMapping[chainId.toString()] &&
    usdcEMapping[chainId.toString()]!.toLowerCase() === address.toLowerCase()
  ) {
    return 'USDC.E'
  }

  return symbol
}

// Indexed once instead of scanned per token. gasTankFeeTokens holds 153 entries
// and a full page carries 230 tokens, so a linear scan cost ~70,000 comparisons
// with two toLowerCase() calls each.
let feeTokenMap: Map<string, (typeof gasTankFeeTokens)[number]> | null = null

function keyForFeeToken(addrLower: string, chainIdNum: number): string {
  return `${addrLower}|${chainIdNum}`
}

function getFeeTokenMap(): Map<string, (typeof gasTankFeeTokens)[number]> {
  if (feeTokenMap) return feeTokenMap
  const map = new Map<string, (typeof gasTankFeeTokens)[number]>()
  for (const t of gasTankFeeTokens) {
    const chainIdNum = Number(t.chainId)
    const k = keyForFeeToken(t.address.toLowerCase(), chainIdNum)
    // First entry wins, because gasTankFeeTokens contains duplicate address and
    // chain pairs and the lookup this replaced returned the first match
    if (!map.has(k)) map.set(k, t)
  }
  feeTokenMap = map
  return map
}

/**
 * Look up a gas-tank fee token by address and chain id in O(1).
 *
 * @param address - token address as it appears in the deployless result
 * @param chainIdKey - the network's chainId rendered as a string, e.g.
 *   `network.chainId.toString()` — or the literal 'gasTank' / 'rewards' for the
 *   internal pseudo-chains
 * @param tokenChainId - the network's chainId as a bigint, used for the gasTank
 *   and rewards pseudo-chains where chainIdKey is not a number
 * @returns the first matching gasTankFeeTokens entry, or undefined
 */
export function getFeeToken(
  address: string,
  chainIdKey: string,
  tokenChainId: bigint
): (typeof gasTankFeeTokens)[number] | undefined {
  // Both the pseudo-chain and the regular case reduce to a numeric chain id, so
  // one index covers them and the branch below only picks where to read it from
  const chainIdNum = ['gasTank', 'rewards'].includes(chainIdKey)
    ? Number(tokenChainId)
    : Number(chainIdKey)
  return getFeeTokenMap().get(keyForFeeToken(address.toLowerCase(), chainIdNum))
}
