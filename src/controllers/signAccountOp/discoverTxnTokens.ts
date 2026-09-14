import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { BaseAccount } from '../../libs/account/BaseAccount'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { createAccessListCall, getShouldUseAccessListCall } from '../../libs/tracer/accessListCall'
import { debugTraceCall, getStateOverride } from '../../libs/tracer/debugTraceCall'
import { ethSimulateV1 } from '../../libs/tracer/ethSimulatev1'

type DiscoveryMethod = 'eth_createAccessList' | 'debug_traceCall' | 'eth_simulateV1'

type DiscoverTxnTokensProps = {
  account: Account
  accountOp: AccountOp
  accountState?: AccountOnchainState
  baseAccount: BaseAccount
  network: Network
  isCurrent: () => boolean
}

type DiscoveredAssets = { tokens: string[]; nfts: [string, bigint[]][] }

const discoveryMethodCache = new Map<string, DiscoveryMethod>()

/**
 * A helper function to use in the tests only
 */
export const clearDiscoverTxnTokensCache = () => discoveryMethodCache.clear()

/**
 * Goal: discover tokens that are interacting with the account during a txn
 * To do this, we use 3 methods:
 * - eth_createAccessList
 * - debug_traceCall
 * - eth_simulateV1
 * The end product of each method is the same. However, different methods
 * are supported on different chains depending on the chain configs and RPC.
 * Also, some accounts require state overrides which may not be supported
 * on the specific chain. That's why we have 3 methods and rely on 1
 * having the exact support we need. Each method is called one by one until
 * we hit a success or all methods have failed.
 * We also have a memory cache. It's simple: record the method that succeeded
 * for chain-account. The next time discoverTxnTokens is called, it will start
 * from the method that was successful.
 */
export async function discoverTxnTokens({
  account,
  accountOp,
  accountState,
  baseAccount,
  network,
  isCurrent
}: DiscoverTxnTokensProps): Promise<DiscoveredAssets | null> {
  // we cannot perform a token discovery if there's no accountState
  if (!accountState) return null

  const stateOverride = getStateOverride(account, accountOp, accountState)
  const shouldUseAccessList = getShouldUseAccessListCall(account, !!stateOverride)
  const methodCalls: Record<DiscoveryMethod, () => Promise<DiscoveredAssets>> = {
    eth_createAccessList: async () => {
      const addresses = await createAccessListCall(baseAccount, accountOp, network, accountState)

      return { tokens: addresses, nfts: addresses.map((address) => [address, []]) }
    },
    debug_traceCall: () =>
      debugTraceCall(baseAccount, accountOp, network, accountState, stateOverride),
    eth_simulateV1: () => ethSimulateV1(baseAccount, accountOp, network, accountState)
  }
  const availableMethods: DiscoveryMethod[] = [
    ...(shouldUseAccessList ? (['eth_createAccessList'] as const) : []),
    'debug_traceCall',
    'eth_simulateV1'
  ]
  const cacheKey = `${network.chainId}-${account.addr}`
  const cachedMethod = discoveryMethodCache.get(cacheKey)
  const orderedMethods =
    cachedMethod && availableMethods.includes(cachedMethod)
      ? [cachedMethod, ...availableMethods.filter((method) => method !== cachedMethod)]
      : availableMethods

  let discoveredAssets: DiscoveredAssets | null = null
  let lastError: unknown

  for (const method of orderedMethods) {
    console.log(`Debug: using ${method} for asset discovery`)

    try {
      discoveredAssets = await methodCalls[method]()
      discoveryMethodCache.set(cacheKey, method)
      break
    } catch (error) {
      lastError = error
      // do not emit an error here as there is a retry mechanism
      console.log(`${method} failed`, error)
    }

    // If this discovery run has been superseded, do not continue with its fallbacks.
    if (!isCurrent()) return null
  }

  if (!discoveredAssets) throw lastError
  if (!isCurrent()) return null
  return discoveredAssets
}
