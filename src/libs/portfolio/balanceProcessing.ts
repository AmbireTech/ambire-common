import { decodeFunctionResult } from 'viem'

import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import NFTGetter from '../../../contracts/compiled/NFTGetter.json'
import { CollectionResult, GetOptions, TokenError, TokenResult } from './interfaces'
import { mapToken, MapTokenNetwork } from './tokenProcessing'

// Decoding and mapping the deployless oracle results is the CPU-heavy part of a
// portfolio update, so both functions here are offloadable tasks (see
// src/libs/offload). That constrains what they may import: viem, tokenProcessing
// and the compiled ABI JSON. NOT ethers — the worklet runtime has none of the
// crypto and process polyfills it expects, and nothing enforces that at build
// time, so check the import graph by hand when adding one here.

export type BalanceKind = 'getBalances' | 'simulateAndGetBalances'
export type CollectionKind = 'getAllNFTs' | 'simulateAndGetAllNFTs'

/** Result of a contract-level simulation, when one was performed. */
export type SimulationResult = {
  simulationErrData: string
  beforeNonce: bigint
  afterNonce: bigint
}

export type ProcessBalancesInput = {
  kind: BalanceKind
  /** Raw hex return data from the deployless contract call. */
  data: `0x${string}`
  /** Reduced network shape — Network satisfies this structurally. */
  network: MapTokenNetwork
  /** ERC20 token addresses the calls were issued with, in call order. */
  tokenAddrs: string[]
  specialErc20Hints?: GetOptions['specialErc20Hints']
  blockTag?: GetOptions['blockTag']
}

export type ProcessCollectionsInput = {
  kind: CollectionKind
  data: `0x${string}`
  network: MapTokenNetwork
  /** Collection addresses the calls were issued with, in call order. */
  tokenAddrs: string[]
}

export type TokenResultEntry = [
  TokenError,
  TokenResult & {
    simulationAmount?: bigint
    amountPostSimulation?: bigint
  }
]

export type CollectionResultEntry = [
  TokenError,
  CollectionResult & {
    simulationAmount?: bigint
    amountPostSimulation?: bigint
    postSimulation?: { sending?: bigint[]; receiving?: bigint[] }
  }
]

export type ProcessBalancesOutput = {
  tokens: TokenResultEntry[]
  /**
   * The oracle's uint256 block number, left as the bigint it decodes to.
   *
   * PortfolioLibGetResult still declares this as `number` and portfolio.ts
   * asserts it back down, but the value has always been a bigint at runtime.
   * Converting it here would be a silent behaviour change on top of a
   * performance refactor, so the existing runtime type is preserved.
   */
  blockNumber: bigint
  simulation: SimulationResult | null
}

export type ProcessCollectionsOutput = {
  collections: CollectionResultEntry[]
  simulation: SimulationResult | null
}

function decode(abi: any, methodName: string, data: `0x${string}`): any {
  if (!data || data === '0x' || data.length < 4) {
    throw new Error(`empty or malformed return data for ${methodName}: ${data}`)
  }

  return decodeFunctionResult({ abi, functionName: methodName, data })
}

function mapNft(
  token: any,
  network: MapTokenNetwork,
  address: string
): Omit<CollectionResult, 'flags' | 'priceIn' | 'marketDataIn'> {
  return {
    name: token.name,
    chainId: network.chainId,
    address,
    symbol: token.symbol,
    amount: BigInt(token.nfts.length),
    decimals: 1,
    collectibles: [...token.nfts]
  }
}

/**
 * Decodes a BalanceGetter result and maps every token slot into a TokenResult.
 * Throws when the return data is empty or cannot be decoded.
 */
export function processBalances(input: ProcessBalancesInput): ProcessBalancesOutput {
  // mapToken only branches on 'both', so any other tag is an equivalent default
  const mapOpts = {
    specialErc20Hints: input.specialErc20Hints,
    blockTag: input.blockTag ?? 'latest'
  }

  if (input.kind === 'getBalances') {
    const [results, blockNumber] = decode(BalanceGetter.abi, 'getBalances', input.data) as [
      any[],
      bigint
    ]

    const tokens: TokenResultEntry[] = results.map((token: any, i: number) => [
      token.error,
      mapToken(token, input.network, input.tokenAddrs[i]!, mapOpts) as TokenResult
    ])

    return { tokens, blockNumber, simulation: null }
  }

  // ABI outputs: (tuple before, tuple afterSimulation, bytes simErr,
  // uint256 gasLeft, uint256 blockNumber, address[] deltaAddressesMapping)
  const [before, after, simulationErr, , blockNumber, deltaAddressesMapping] = decode(
    BalanceGetter.abi,
    'simulateAndGetBalances',
    input.data
  ) as [any, any, string, any, bigint, string[]]

  const beforeNonce = before.nonce
  const afterNonce = after.nonce
  // A simulation was performed if the nonce changed
  const hasSimulation = afterNonce !== beforeNonce

  // Indexed by raw address, matching the case-sensitive comparison this branch
  // has always used. First entry wins on duplicates, as a .find would.
  const simulationByAddr = new Map<string, any>()
  if (hasSimulation) {
    after.balances.forEach((simulationToken: any, tokenIndex: number) => {
      const addr = deltaAddressesMapping[tokenIndex]
      if (addr === undefined || simulationByAddr.has(addr)) return

      simulationByAddr.set(addr, { ...simulationToken, addr })
    })
  }

  const tokens: TokenResultEntry[] = before.balances.map((token: any, i: number) => {
    const simulation = hasSimulation ? (simulationByAddr.get(input.tokenAddrs[i]!) ?? null) : null

    // Here's the math behind `simulationAmount` and `amountPostSimulation`.
    // AccountA initial balance: 10 USDC.
    // AccountA attempts to transfer 5 USDC (not signed yet).
    // An external entity sends 3 USDC to AccountA on-chain.
    // Deployless simulation contract processing:
    //   - Balance before simulation (before.balances): 10 USDC + 3 USDC = 13 USDC.
    //   - Balance after simulation (after.balances): 10 USDC - 5 USDC + 3 USDC = 8 USDC.
    // Simulation-only balance displayed on the Sign Screen (`simulationAmount`):
    //   - difference between after simulation and before: 8 USDC - 13 USDC = -5 USDC
    // Final balance displayed on the Dashboard (`amountPostSimulation`):
    //   - after.balances, 8 USDC.
    const simulationAmount = simulation ? simulation.amount - token.amount : undefined
    const amountPostSimulation = simulation ? simulation.amount : token.amount

    const mapped = mapToken(
      token,
      input.network,
      input.tokenAddrs[i]!,
      mapOpts,
      !!simulationAmount,
      token.amount
    ) as TokenResult

    // Spread after mapToken, or the blockTag 'both' branch would drop these
    return [token.error, { ...mapped, simulationAmount, amountPostSimulation }]
  })

  return {
    tokens,
    blockNumber,
    simulation: { simulationErrData: simulationErr, beforeNonce, afterNonce }
  }
}

/**
 * Decodes an NFTGetter result and maps every collection slot into a
 * CollectionResult. Throws when the return data is empty or cannot be decoded.
 */
export function processCollections(input: ProcessCollectionsInput): ProcessCollectionsOutput {
  if (input.kind === 'getAllNFTs') {
    // viem returns a single ABI output unwrapped, unlike multi-output functions
    const collections = decode(NFTGetter.abi, 'getAllNFTs', input.data) as any[]

    return {
      collections: collections.map((token: any, index: number) => [
        token.error,
        mapNft(token, input.network, input.tokenAddrs[index]!) as CollectionResult
      ]),
      simulation: null
    }
  }

  const [before, after, simulationErr, , , deltaAddressesMapping] = decode(
    NFTGetter.abi,
    'simulateAndGetAllNFTs',
    input.data
  ) as [any, any, string, any, any, string[]]

  const beforeNonce = before.nonce
  const afterNonce = after.nonce
  const hasSimulation = afterNonce !== beforeNonce

  // Indexed by lowercased address. Unlike the ERC20 branch above, this one has
  // always compared case-insensitively, and that difference is preserved.
  const simulationByAddrLower = new Map<string, any>()
  if (hasSimulation) {
    after.collections.forEach((simulationToken: any, tokenIndex: number) => {
      const addr = deltaAddressesMapping[tokenIndex]
      if (addr === undefined) return

      const key = addr.toLowerCase()
      if (simulationByAddrLower.has(key)) return

      simulationByAddrLower.set(key, { ...mapNft(simulationToken, input.network, addr), addr })
    })
  }

  const collections: CollectionResultEntry[] = before.collections.map(
    (beforeToken: any, i: number) => {
      const token = mapNft(beforeToken, input.network, input.tokenAddrs[i]!)
      const simulationToken = hasSimulation
        ? (simulationByAddrLower.get(input.tokenAddrs[i]!.toLowerCase()) ?? null)
        : null
      const receiving: bigint[] = []
      const sending: bigint[] = []

      token.collectibles.forEach((oldCollectible: bigint) => {
        // the first check is required because if there are no changes we will always have !undefined from the second check
        if (simulationToken?.collectibles && !simulationToken.collectibles.includes(oldCollectible))
          sending.push(oldCollectible)
      })
      simulationToken?.collectibles?.forEach((newCollectible: bigint) => {
        if (!token.collectibles.includes(newCollectible)) receiving.push(newCollectible)
      })

      return [
        beforeToken.error,
        {
          ...token,
          // Please refer to processBalances for more info regarding `simulationAmount` calc
          simulationAmount: simulationToken ? simulationToken.amount - token.amount : undefined,
          amountPostSimulation: simulationToken ? simulationToken.amount : token.amount,
          postSimulation: { receiving, sending }
        } as CollectionResult
      ]
    }
  )

  return { collections, simulation: { simulationErrData: simulationErr, beforeNonce, afterNonce } }
}
