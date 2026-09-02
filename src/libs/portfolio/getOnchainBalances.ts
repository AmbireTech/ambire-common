import { CallTuple } from '@/libs/accountOp/types'

import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { EOA_SIMULATION_NONCE } from '../../consts/deployless'
import { Network } from '../../interfaces/network'
import { getPendingBlockTagIfSupported } from '../../utils/getBlockTag'
import { yieldToMain } from '../../utils/scheduler'
import {
  getNotAmbireStateOverride,
  getShouldStateOverride
} from '../../utils/simulationStateOverride'
import { getAccountDeployParams } from '../account/account'
import { AccountOp, callToTuple, toSingletonCall } from '../accountOp/accountOp'
import { Deployless, DeploylessMode } from '../deployless/deployless'
import { decodeError } from '../errorDecoder'
import { DEPLOYLESS_ERRORS } from '../errorHumanizer/errors'
import { getHumanReadableErrorMessage } from '../errorHumanizer/helpers'
import {
  CollectionMetadataFetchPlan,
  CollectionResult,
  DeploylessContractOptions,
  GetOptions,
  GetOptionsSimulation,
  LimitsOptions,
  MetaData,
  TokenError,
  TokenMetadataFetchPlan,
  TokenResult
} from './interfaces'
import { mapToken } from './tokenProcessing'

class SimulationError extends Error {
  public simulationErrorMsg: string

  public beforeNonce: bigint

  public afterNonce: bigint

  constructor(message: string, beforeNonce: bigint, afterNonce: bigint) {
    super(message)
    this.simulationErrorMsg = message
    this.beforeNonce = beforeNonce
    this.afterNonce = afterNonce
    console.error('simulation error: ', {
      beforeNonce,
      afterNonce,
      message
    })
  }
}

function handleSimulationError(
  errorData: string,
  beforeNonce: bigint,
  afterNonce: bigint,
  simulationOps: { nonce: bigint | null; calls: CallTuple[] }[]
) {
  if (errorData !== '0x') {
    const error = new Error(errorData)
    ;(error as any).data = errorData
    const decodedError = decodeError(error)
    const humanizedError = getHumanReadableErrorMessage(
      null,
      DEPLOYLESS_ERRORS,
      'Transaction cannot be simulated because',
      decodedError,
      error
    )
    const fallbackMessage = `Transaction cannot be simulated because of an unknown error. Error code: ${
      decodedError.reason || errorData.slice(0, 10)
    }`

    throw new SimulationError(humanizedError || fallbackMessage, beforeNonce, afterNonce)
  }

  // If the afterNonce is 0, it means that we reverted, even if the error is empty
  // In both BalanceOracle and NFTOracle, afterSimulation and therefore afterNonce will be left empty
  if (afterNonce === 0n) throw new SimulationError('Simulation reverted', beforeNonce, afterNonce)

  if (afterNonce < beforeNonce)
    throw new SimulationError(
      'simulation error: lower "after" nonce, should not be possible',
      beforeNonce,
      afterNonce
    )
  if (simulationOps.length && afterNonce === beforeNonce)
    throw new SimulationError(
      'Account op passed for simulation but the nonce did not increment. Perhaps wrong nonce set in Account op',
      beforeNonce,
      afterNonce
    )

  // make sure the afterNonce (after all the accOps execution) is
  // at least the same as the final nonce in the simulationOps
  const nonces: bigint[] = simulationOps
    .map((op) => op.nonce ?? -1n)
    .filter((nonce) => nonce !== -1n)
    .sort((a, b) => {
      if (a === b) return 0
      if (a > b) return 1
      return -1
    })
  if (nonces.length && afterNonce < nonces[nonces.length - 1]! + 1n) {
    throw new SimulationError(
      'simulation error: Failed to increment the nonce to the final account op nonce',
      beforeNonce,
      afterNonce
    )
  }
}

export function getDeploylessOpts(
  accountAddr: string,
  network: Network,
  opts: {
    simulation?: GetOptionsSimulation<AccountOp[]>
    blockTag?: GetOptions['blockTag']
    deployless?: DeploylessContractOptions
  }
) {
  if (opts.deployless) {
    return {
      blockTag: opts.blockTag,
      from: DEPLOYLESS_SIMULATION_FROM,
      mode: opts.deployless.mode,
      to: opts.deployless.to,
      stateToOverride: null
    }
  }

  const shouldStateOverride =
    !!opts.simulation && getShouldStateOverride(network, opts.simulation.baseAccount)

  return {
    blockTag: opts.blockTag,
    from: DEPLOYLESS_SIMULATION_FROM,
    mode: shouldStateOverride ? DeploylessMode.StateOverride : DeploylessMode.Detect,
    stateToOverride: shouldStateOverride ? getNotAmbireStateOverride(accountAddr, network) : null
  }
}

/**
 * Turns the plan into what the contract takes and what the results are read back with,
 * for one page. `metaFlags` marks the assets whose metadata has to be read, one byte
 * per asset, because repeating those assets' addresses in a second array would cost a
 * whole word each while the caller usually knows most of them already. Trailing assets
 * are left out, as the contract reads a missing flag as no metadata.
 * `metaIndexByAddress` says where each flagged asset sits in the returned metadata,
 * which the contract packs in the same order.
 */
export function planMetaRequest(
  addresses: string[],
  needsMetadata: Set<string>
): { metaFlags: string; metaIndexByAddress: Map<string, number> } {
  const flags: string[] = []
  const metaIndexByAddress = new Map<string, number>()

  addresses.forEach((address, index) => {
    if (!needsMetadata.has(address)) return

    // Fill in the assets in between, which need nothing read for them
    while (flags.length < index) flags.push('00')

    flags.push('01')
    metaIndexByAddress.set(address, metaIndexByAddress.size)
  })

  return { metaFlags: `0x${flags.join('')}`, metaIndexByAddress }
}

export async function getNFTs(
  network: Network,
  deployless: Deployless,
  opts: Pick<GetOptions, 'simulation' | 'blockTag' | 'deployless'> & {
    metadataPlan: CollectionMetadataFetchPlan
  },
  accountAddr: string,
  tokenAddrs: [string, bigint[]][],
  limits: LimitsOptions
): Promise<[[TokenError, CollectionResult][], object][]> {
  const deploylessOpts = getDeploylessOpts(accountAddr, network, {
    ...opts,
    blockTag:
      opts.blockTag === 'pending' || opts.blockTag === 'both'
        ? getPendingBlockTagIfSupported(network)
        : opts.blockTag,
    deployless: opts.deployless?.erc721
  })

  const collectionAddrs = tokenAddrs.map(([address]) => address)
  const tokenIds = tokenAddrs.map(([, ids]) => ids.slice(0, limits.erc721TokensInput))
  // The request is built from this page, never from the full, unpaginated hint list
  const { metaFlags, metaIndexByAddress } = planMetaRequest(
    collectionAddrs,
    opts.metadataPlan.needsMetadata
  )

  /**
   * Rebuilds a collection from the token ids it holds, taking the name and symbol
   * either from this call or from the caller's stored copy. The chain reads both with
   * one call per collection, so a failure of either is reported on the token ids.
   */
  const resolveCollection = (
    address: string,
    balance: any,
    metas: any[]
  ): {
    error: TokenError
    collection: Omit<CollectionResult, 'flags' | 'priceIn' | 'marketDataIn'>
  } => {
    const metaIndex = metaIndexByAddress.get(address)
    const fetchedMeta = metaIndex === undefined ? undefined : metas[metaIndex]
    const knownMeta = fetchedMeta ? undefined : opts.metadataPlan.known.get(address)
    const collectibles: bigint[] = [...balance.nfts]

    return {
      error: balance.error,
      collection: {
        name: fetchedMeta?.name ?? knownMeta?.name ?? '',
        symbol: fetchedMeta?.symbol ?? knownMeta?.symbol ?? '',
        chainId: network.chainId,
        address,
        amount: BigInt(collectibles.length),
        decimals: 1,
        collectibles
      }
    }
  }

  if (!opts.simulation) {
    const [balances, metas] = await deployless.call(
      'getAllNFTs',
      [accountAddr, collectionAddrs, tokenIds, limits.erc721Tokens, metaFlags],
      deploylessOpts
    )

    return [
      balances.map((balance: any, index: number) => {
        const { error, collection } = resolveCollection(collectionAddrs[index]!, balance, metas)

        return [error, collection]
      }),
      {}
    ]
  }

  const { accountOps, baseAccount } = opts.simulation
  const account = baseAccount.getAccount()
  const [factory, factoryCalldata] = getAccountDeployParams(account)
  const shouldStateOverride = getShouldStateOverride(network, baseAccount)
  const simulationOps = accountOps.map(({ nonce, calls }, idx) => ({
    // state overriden accounts start from a fake, specified nonce
    nonce: !shouldStateOverride ? nonce : BigInt(EOA_SIMULATION_NONCE) + BigInt(idx),
    calls: calls.map(toSingletonCall).map(callToTuple)
  }))
  const [before, after, metas, simulationErr, , , deltaAddressesMapping] = await deployless.call(
    'simulateAndGetAllNFTs',
    [
      accountAddr,
      shouldStateOverride ? [account.addr] : account.associatedKeys,
      collectionAddrs,
      tokenIds,
      limits.erc721Tokens,
      metaFlags,
      factory,
      factoryCalldata,
      simulationOps.map((op) => Object.values(op))
    ],
    deploylessOpts
  )

  const beforeNonce = before.nonce
  const afterNonce = after.nonce
  handleSimulationError(simulationErr, beforeNonce, afterNonce, simulationOps)

  // simulation was performed if the nonce is changed
  const hasSimulation = afterNonce !== beforeNonce

  // Index all to prevent nested loops
  const simulationCollectiblesByAddr = new Map<string, bigint[]>()

  if (hasSimulation) {
    after.collections.forEach((simulationCollection: any, collectionIndex: number) => {
      const addr = deltaAddressesMapping[collectionIndex]

      if (addr === undefined) return

      const key = addr.toLowerCase()

      if (simulationCollectiblesByAddr.has(key)) return

      simulationCollectiblesByAddr.set(key, [...simulationCollection.nfts])
    })
  }

  return [
    before.collections.map((balance: any, i: number) => {
      const address = collectionAddrs[i]!
      const simulationCollectibles = hasSimulation
        ? simulationCollectiblesByAddr.get(address.toLowerCase())
        : undefined
      const { error, collection } = resolveCollection(address, balance, metas)
      const receiving: bigint[] = []
      const sending: bigint[] = []

      collection.collectibles.forEach((oldCollectible: bigint) => {
        // the first check is required because if there are no changes we will always have !undefined from the second check
        if (simulationCollectibles && !simulationCollectibles.includes(oldCollectible))
          sending.push(oldCollectible)
      })
      simulationCollectibles?.forEach((newCollectible: bigint) => {
        if (!collection.collectibles.includes(newCollectible)) receiving.push(newCollectible)
      })

      const simulationAmount = simulationCollectibles ? BigInt(simulationCollectibles.length) : null

      return [
        error,
        {
          ...collection,
          // Please refer to getTokens() for more info regarding `amountBeforeSimulation` calc
          simulationAmount:
            simulationAmount === null ? undefined : simulationAmount - collection.amount,
          amountPostSimulation: simulationAmount === null ? collection.amount : simulationAmount,
          postSimulation: { receiving, sending }
        }
      ]
    }),
    {}
  ]
}

export async function getTokens(
  network: Network,
  deployless: Deployless,
  opts: Pick<GetOptions, 'simulation' | 'blockTag' | 'specialErc20Hints' | 'deployless'> & {
    metadataPlan: TokenMetadataFetchPlan
  },
  accountAddr: string,
  tokenAddrs: string[],
  pageIndex?: number
): Promise<[[TokenError, TokenResult][], MetaData][]> {
  if (typeof pageIndex === 'number' && pageIndex > 0) {
    // Allow the main thread to process other tasks before continuing
    // as encode/decode operations (in deployless) are very CPU intensive
    await yieldToMain()
  }

  const isFetchingBothBlocks = opts.blockTag === 'both'

  const deploylessOpts = getDeploylessOpts(accountAddr, network, {
    ...opts,
    blockTag:
      opts.blockTag === 'pending' || isFetchingBothBlocks
        ? getPendingBlockTagIfSupported(network)
        : opts.blockTag,
    deployless: opts.deployless?.erc20
  })

  // The request is built from this page, never from the full, unpaginated hint list
  const { metaFlags, metaIndexByAddress } = planMetaRequest(
    tokenAddrs,
    opts.metadataPlan.needsMetadata
  )

  /**
   * Rebuilds what mapToken expects from a balance-only result, taking metadata either
   * from this call or from the caller's stored copy. The chain reads both with one call
   * per token, so a failure of either is reported on the balance.
   */
  const resolveToken = (address: string, balance: any, metas: any[]) => {
    const metaIndex = metaIndexByAddress.get(address)
    const fetchedMeta = metaIndex === undefined ? undefined : metas[metaIndex]

    if (fetchedMeta) {
      return {
        amount: balance.amount,
        symbol: fetchedMeta.symbol,
        name: fetchedMeta.name,
        decimals: fetchedMeta.decimals,
        error: balance.error
      }
    }

    const knownMeta = opts.metadataPlan.known.get(address)

    return {
      amount: balance.amount,
      symbol: knownMeta?.symbol ?? '',
      name: knownMeta?.name ?? '',
      decimals: knownMeta?.decimals ?? 0,
      error: balance.error
    }
  }

  if (!opts.simulation) {
    const [balances, metas, blockNumber] = await deployless.call(
      'getBalances',
      [accountAddr, tokenAddrs, metaFlags],
      deploylessOpts
    )

    return [
      balances.map((balance: any, i: number) => {
        const token = resolveToken(tokenAddrs[i]!, balance, metas)

        return [
          token.error,
          mapToken(token, network, tokenAddrs[i]!, opts, undefined, token.amount)
        ]
      }),
      {
        // The getter returns a uint256, so it has to be brought back to a number
        blockNumber: Number(blockNumber)
      }
    ]
  }

  const { accountOps, baseAccount } = opts.simulation
  const account = baseAccount.getAccount()
  const shouldStateOverride = getShouldStateOverride(network, baseAccount)
  const simulationOps = accountOps.map(({ nonce, calls }, idx) => ({
    // state overriden accounts start from a fake, specified nonce
    nonce: !shouldStateOverride ? nonce : BigInt(EOA_SIMULATION_NONCE) + BigInt(idx),
    calls: calls.map(toSingletonCall).map(callToTuple)
  }))
  const [factory, factoryCalldata] = getAccountDeployParams(account)
  const [before, after, metas, simulationErr, , blockNumber, deltaAddressesMapping] =
    await deployless.call(
      'simulateAndGetBalances',
      [
        accountAddr,
        shouldStateOverride ? [account.addr] : account.associatedKeys,
        tokenAddrs,
        metaFlags,
        factory,
        factoryCalldata,
        simulationOps.map((op) => Object.values(op))
      ],
      deploylessOpts
    )

  const beforeNonce = before.nonce
  const afterNonce = after.nonce
  handleSimulationError(simulationErr, beforeNonce, afterNonce, simulationOps)

  // simulation was performed if the nonce is changed
  const hasSimulation = afterNonce !== beforeNonce

  // Index all to prevent nested loops
  const simulationTokensByAddr = new Map<string, any>()

  if (hasSimulation) {
    after.balances.forEach((simulationToken: any, tokenIndex: number) => {
      const addr = deltaAddressesMapping[tokenIndex]

      if (addr === undefined || simulationTokensByAddr.has(addr)) return

      simulationTokensByAddr.set(addr, { ...simulationToken, addr })
    })
  }

  return [
    before.balances.map((balance: any, i: number) => {
      const token = resolveToken(tokenAddrs[i]!, balance, metas)
      const simulation = hasSimulation ? (simulationTokensByAddr.get(tokenAddrs[i]!) ?? null) : null

      const simulationAmount = simulation ? simulation.amount - token.amount : undefined
      const amountPostSimulation = simulation ? simulation.amount : token.amount

      // Here's the math before `simulationAmount` and `amountPostSimulation`.
      // AccountA initial balance: 10 USDC.
      // AccountA attempts to transfer 5 USDC (not signed yet).
      // An external entity sends 3 USDC to AccountA on-chain.
      // Deployless simulation contract processing:
      //   - Balance before simulation (before.balances): 10 USDC + 3 USDC = 13 USDC.
      //   - Balance after simulation (after.balances): 10 USDC - 5 USDC + 3 USDC = 8 USDC.
      // Simulation-only balance displayed on the Sign Screen (we will call it `simulationAmount`):
      //   - difference between after simulation and before: 8 USDC - 13 USDC = -5 USDC
      // Final balance displayed on the Dashboard (we will call it `amountPostSimulation`):
      //   - after.balances, 8 USDC.
      return [
        token.error,
        {
          ...mapToken(token, network, tokenAddrs[i]!, opts, !!simulationAmount, token.amount),
          simulationAmount,
          amountPostSimulation
        }
      ]
    }),
    {
      // The getter returns a uint256, so it has to be brought back to a number
      blockNumber: Number(blockNumber),
      beforeNonce,
      afterNonce
    }
  ]
}
