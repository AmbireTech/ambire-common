import { toBeHex } from 'ethers'

import { Account, AccountStates } from '@/interfaces/account'
import { isAmbireV1LinkedAccount } from '@/libs/account/account'

import { AMBIRE_ACCOUNT_FACTORY, OPTIMISTIC_ORACLE, SINGLETON } from '../../consts/deploy'
import { networks as predefinedNetworks } from '../../consts/networks'
import { Fetch } from '../../interfaces/fetch'
import {
  Erc4337settings,
  Network,
  NetworkFeature,
  NetworkInfo,
  NetworkInfoLoading,
  RelayerNetwork,
  SupportedNetworks
} from '../../interfaces/network'
import { RPCProvider, RPCProviders } from '../../interfaces/provider'
import { Bundler } from '../../services/bundlers/bundler'
import { fetchWithTimeout } from '../../utils/fetch'
import { mapRelayerNetworkConfigToAmbireNetwork } from '../../utils/networks'
import { getSASupport } from '../deployless/simulateDeployCall'

const STATE_OVERRIDE_TEST_ADDRESS = '0x0000000000000000000000000000000000696969'
const STATE_OVERRIDE_TEST_CODE_RETURNING_ONE = '0x600160005260206000f3'
const STATE_OVERRIDE_TEST_RESULT = toBeHex(1, 32)

/** How long to wait for our price API to return the price ids of a network. */
export const NETWORK_PRICE_IDS_TIMEOUT_MS = 10000

// bnb, gnosis, fantom, metis
export const relayerAdditionalNetworks = [
  {
    chainId: 56n,
    name: 'binance-smart-chain'
  },
  {
    chainId: 100n,
    name: 'gnosis'
  },
  {
    chainId: 250n,
    name: 'fantom'
  },
  {
    chainId: 1088n,
    name: 'andromeda'
  }
]

// 4337 network support
// if it is supported on the network (hasBundlerSupport),
// we check if the network is predefinedNetwork and we
// have specifically disabled 4337
// finally, we fallback to the bundler support
export function is4337Enabled(hasBundlerSupport: boolean, network?: Network): boolean {
  if (!hasBundlerSupport) return false

  // if we have set it specifically
  if (network && network.predefined) return true

  // this will be true in this case
  return hasBundlerSupport
}

export const getNetworksWithFailedRPC = ({ providers }: { providers: RPCProviders }): string[] => {
  return Object.keys(providers).filter(
    (chainId) =>
      providers[chainId] &&
      typeof providers[chainId].isWorking === 'boolean' &&
      !providers[chainId].isWorking
  )
}

async function retryRequest(init: () => any, counter = 0): Promise<any> {
  if (counter >= 2) {
    throw new Error('flagged')
  }

  const promise: Promise<any> = init()
  const result = await promise.catch(async () => {
    const retryRes = await retryRequest(init, counter + 1)
    return retryRes
  })

  return result
}

export function getProviderBatchMaxCount(network: Network, rpcUrl: string): number | undefined {
  const hasUserChangedRpc = !!network.suggestedRpcUrl && network.suggestedRpcUrl !== rpcUrl

  // if the user hasn't changed the RPC the relayer has returned for this network
  // and there's a set suggestedRpcBatchCount, return it
  // there are cases where we use invictus (hyperevm) and regardless, we want
  // to disable batching. Therefore, always use suggestedRpcBatchCount with priority
  // if the RPC hasn't changed
  if (!hasUserChangedRpc && network.suggestedRpcBatchCount) return network.suggestedRpcBatchCount

  if (rpcUrl.includes('invictus.ambire.com')) return 20

  // no batching for custom networks
  if (!network.predefinedConfigVersion) return 1

  // a special rule for ethereum because we're resolving ENSes there:
  // no invictus = batch limit of 3 to prevent rate limit
  if (network.chainId === 1n && hasUserChangedRpc) return 3

  // if suggestedRpcBatchCount is not provided, make the limit 1
  // as we don't want to risk it by making it infinite
  const suggestedRpcBatchCount = network.suggestedRpcBatchCount ?? 1
  return hasUserChangedRpc ? 1 : suggestedRpcBatchCount
}

export async function getStateOverrideSupport(provider: RPCProvider): Promise<boolean> {
  try {
    const result = await provider.send('eth_call', [
      { to: STATE_OVERRIDE_TEST_ADDRESS, data: '0x' },
      'latest',
      { [STATE_OVERRIDE_TEST_ADDRESS]: { code: STATE_OVERRIDE_TEST_CODE_RETURNING_ONE } }
    ])

    return result === STATE_OVERRIDE_TEST_RESULT
  } catch {
    return false
  }
}

/**
 * The network info shape before any RPC probe has resolved. Every field is
 * 'LOADING' except the chain id.
 */
export function getLoadingNetworkInfo(chainId: bigint): NetworkInfoLoading<NetworkInfo> {
  return {
    chainId,
    isSAEnabled: 'LOADING',
    hasSingleton: 'LOADING',
    isOptimistic: 'LOADING',
    rpcNoStateOverride: 'LOADING',
    erc4337: 'LOADING',
    areContractsDeployed: 'LOADING',
    feeOptions: 'LOADING',
    platformId: 'LOADING',
    nativeAssetId: 'LOADING',
    flagged: 'LOADING'
  }
}

/**
 * True while any of the probes behind the network info is still running.
 */
export function isNetworkInfoPending(info?: NetworkInfoLoading<NetworkInfo>): boolean {
  return !info || Object.values(info).some((prop) => prop === 'LOADING')
}

/**
 * Looks up the ids our price API (CoinGecko under the hood) knows a network by - its
 * platform id (for token prices) and native asset id (for the native token price).
 *
 * Call it only when the user hasn't opted out of token prices, because the requests
 * to our price API carry analytics data.
 *
 * The request is aborted after `timeoutMs`, so that a price API that never responds
 * can't leave the caller waiting forever.
 *
 * @returns the ids, or null if the network isn't supported by the price API or the
 * request failed or timed out
 */
export async function fetchNetworkPriceIds(
  fetch: Fetch,
  chainId: bigint,
  timeoutMs: number = NETWORK_PRICE_IDS_TIMEOUT_MS
): Promise<Pick<NetworkInfo, 'platformId' | 'nativeAssetId'> | null> {
  try {
    const coingeckoRequest = await fetchWithTimeout(
      fetch,
      `https://cena.ambire.com/api/v3/platform/${Number(chainId)}`,
      {},
      timeoutMs
    )
    const coingeckoInfo = await coingeckoRequest.json()

    // Coingecko info not found
    if (coingeckoInfo.error) return null

    return { platformId: coingeckoInfo.platformId, nativeAssetId: coingeckoInfo.nativeAssetId }
  } catch (e) {
    console.error('Error fetching coingecko info', e)

    return null
  }
}

/**
 * The ERC-4337 settings of a network's info, from the bundler's answer to whether it supports
 * the network.
 *
 * `hasBundlerSupport` is null when the bundler wasn't asked, because the user turned ERC-4337
 * off. Then the network's last known settings are kept, and a network that is being added gets
 * no `hasBundlerSupport` at all, which marks it as never checked - so that it gets checked once
 * ERC-4337 is turned back on.
 */
export function getErc4337Info(
  hasBundlerSupport: boolean | null,
  network: Network | undefined
): Erc4337settings {
  if (hasBundlerSupport === null) return network?.erc4337 ?? { enabled: false, hasPaymaster: false }

  return {
    enabled: is4337Enabled(hasBundlerSupport, network),
    hasPaymaster: network ? network.erc4337.hasPaymaster : false,
    hasBundlerSupport
  }
}

/**
 * Fetches a network's capabilities from an RPC provider - smart account support, ERC-4337,
 * fee options and price metadata.
 *
 * The price metadata is fetched only if `isTokenPricesEnabled` - otherwise the network's
 * current values are kept (empty for a network that is being added).
 *
 * The bundler is asked about ERC-4337 support only if `isErc4337Enabled` - otherwise the
 * network's current ERC-4337 settings are kept (see `getErc4337Info`).
 *
 * Streams progress through `callback`.
 */
export async function getNetworkInfo(
  fetch: Fetch,
  chainId: bigint,
  provider: RPCProvider,
  callback: (networkInfo: NetworkInfoLoading<NetworkInfo>) => void,
  network: Network | undefined,
  isTokenPricesEnabled: boolean = true,
  isErc4337Enabled: boolean = true
) {
  let networkInfo: NetworkInfoLoading<NetworkInfo> = getLoadingNetworkInfo(chainId)
  callback(networkInfo)

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = (time: number = 30000): Promise<'timeout reached'> => {
    return new Promise((resolve) => {
      timeoutId = setTimeout(resolve, time, 'timeout reached')
    }) as unknown as Promise<'timeout reached'>
  }

  let flagged = false

  const raiseFlagged = (e: Error, returnData: any): any => {
    if (e.message === 'flagged') {
      flagged = true
    }

    return returnData
  }

  let info: unknown
  try {
    info = await Promise.race([
      Promise.all([
        (async () => {
          const responses = await Promise.all([
            retryRequest(() => provider.getCode(SINGLETON)),
            retryRequest(() => provider.getCode(AMBIRE_ACCOUNT_FACTORY)),
            retryRequest(() => getSASupport(provider)),
            retryRequest(() => getStateOverrideSupport(provider)),
            isErc4337Enabled ? Bundler.isNetworkSupported(fetch, chainId).catch(() => false) : null
            // retryRequest(() => provider.getCode(ERC_4337_ENTRYPOINT)),
          ]).catch((e: Error) =>
            raiseFlagged(e, [
              '0x',
              '0x',
              { addressMatches: false },
              false,
              isErc4337Enabled ? false : null
            ])
          )
          const [singletonCode, factoryCode, saSupport, supportsStateOverride, hasBundlerSupport] =
            responses
          const areContractsDeployed = factoryCode !== '0x'
          // const has4337 = entryPointCode !== '0x' && hasBundler

          // Ambire support is as follows:
          // - either the addresses match after simulation, that's perfect
          // - or we can't do the simulation with this RPC but we have the factory
          // deployed on the network
          const supportsAmbire =
            saSupport.addressMatches || (!supportsStateOverride && areContractsDeployed)
          networkInfo = {
            ...networkInfo,
            hasSingleton: singletonCode !== '0x',
            isSAEnabled: supportsAmbire && singletonCode !== '0x',
            areContractsDeployed,
            rpcNoStateOverride: !supportsStateOverride,
            erc4337: getErc4337Info(hasBundlerSupport, network)
          }

          callback(networkInfo)
        })(),
        (async () => {
          const oracleCode = await retryRequest(() => provider.getCode(OPTIMISTIC_ORACLE)).catch(
            (e: Error) => raiseFlagged(e, '0x')
          )
          const isOptimistic = oracleCode !== '0x'

          networkInfo = { ...networkInfo, isOptimistic }
        })(),
        (async () => {
          const block = await retryRequest(() => provider.getBlock('latest')).catch((e: Error) =>
            raiseFlagged(e, null)
          )
          const feeOptions = { is1559: block?.baseFeePerGas !== null }

          networkInfo = { ...networkInfo, feeOptions }
        })(),
        (async () => {
          // Keep the old value if the request fails or the user has opted out of token
          // prices. Resolved to a value either way, so that the info stops being pending.
          const priceIds = isTokenPricesEnabled ? await fetchNetworkPriceIds(fetch, chainId) : null

          networkInfo = {
            ...networkInfo,
            platformId: priceIds?.platformId ?? (network?.platformId || ''),
            nativeAssetId: priceIds?.nativeAssetId ?? (network?.nativeAssetId || '')
          }

          callback(networkInfo)
        })()
      ]),
      timeout()
    ])
  } finally {
    clearTimeout(timeoutId)
  }

  networkInfo = { ...networkInfo, flagged: flagged || info === 'timeout reached' }
  callback(networkInfo)
}

/**
 * The network properties that the smart accounts support is decided from. Both a stored
 * `Network` and the info of a network that is being checked (`NetworkInfoLoading`) fit.
 */
export type SmartAccountsSupportInfo = {
  [K in 'isSAEnabled' | 'areContractsDeployed' | 'erc4337' | 'hasSingleton']:
    | NetworkInfo[K]
    | 'LOADING'
} & { flagged?: NetworkInfo['flagged'] | 'LOADING' }

/** The smart accounts support info of a network that is still being checked */
export const SMART_ACCOUNTS_SUPPORT_LOADING_INFO: SmartAccountsSupportInfo = {
  isSAEnabled: 'LOADING',
  areContractsDeployed: 'LOADING',
  erc4337: 'LOADING',
  hasSingleton: 'LOADING',
  flagged: 'LOADING'
}

/**
 * Whether Ambire smart accounts can be used on a network, as one status to show to the user.
 *
 * - An RPC error (`flagged`) takes priority, as nothing else about the network is known then
 * - Reported as disabled if the user has opted out of ERC-4337 (`isErc4337Enabled` is false),
 *   regardless of whether the network supports smart accounts
 * - `initial` when there is no info at all and `loading` while it's still being checked
 */
export function getSmartAccountsFeature(
  info: SmartAccountsSupportInfo | undefined,
  network?: Network,
  isErc4337Enabled: boolean = true
): NetworkFeature {
  if (!info) return { id: 'saSupport', title: 'Not checked yet', level: 'initial' }

  if (info.flagged === true) {
    return {
      id: 'flagged',
      title: 'RPC error',
      level: 'danger',
      msg: 'We were unable to fetch the network information with the provided RPC. Try choosing a different RPC.'
    }
  }

  if (!isErc4337Enabled) {
    return {
      id: 'saSupport',
      title: 'Disabled',
      level: 'warning',
      msg: 'ERC-4337 is turned off in your privacy settings, so smart accounts can’t use some of their features, like paying the fee with other tokens. Turn it back on to use them.',
      isTurnedOff: true
    }
  }

  const { isSAEnabled, areContractsDeployed, erc4337, hasSingleton } = info
  if (
    isSAEnabled === 'LOADING' ||
    areContractsDeployed === 'LOADING' ||
    erc4337 === 'LOADING' ||
    hasSingleton === 'LOADING'
  ) {
    return { id: 'saSupport', title: 'Checking...', level: 'loading' }
  }

  const canBroadcast = erc4337.enabled || network?.hasRelayer
  if (!isSAEnabled || !canBroadcast) return { id: 'saSupport', title: 'Not supported', level: 'danger' }

  if (areContractsDeployed) return { id: 'saSupport', title: 'Supported', level: 'success' }

  return {
    id: 'saSupport',
    title: 'Contracts not deployed',
    level: 'warning',
    msg: "This network supports Smart Accounts, but Ambire Wallet's contracts have not yet been deployed. You can deploy them by using an EOA account and the deploy contracts option to unlock the Smart Accounts feature. Otherwise, only EOA accounts can be used on this network."
  }
}

export function hasRelayerSupport(network: Network) {
  return (
    network.hasRelayer || !!relayerAdditionalNetworks.find((net) => net.chainId === network.chainId)
  )
}

/**
 * Validates a single network object against some of the Network interface requirements.
 */
export function sanityCheckImportantNetworkProperties(network: Network) {
  if (!network || typeof network !== 'object') return false

  if (typeof network.chainId !== 'bigint') return false
  if (typeof network.name !== 'string') return false
  if (typeof network.nativeAssetSymbol !== 'string') return false
  if (typeof network.nativeAssetName !== 'string') return false
  if (typeof network.explorerUrl !== 'string') return false
  if (typeof network.selectedRpcUrl !== 'string') return false

  if (!Array.isArray(network.rpcUrls)) return false
  if (network.rpcUrls.some((url) => typeof url !== 'string')) return false

  return true
}

/**
 * Validates networks coming from the storage, filtering out the invalid ones.
 * This prevents crashes when networks have missing or invalid mandatory properties.
 */
export function getValidNetworks(networksInStorage: { [key: string]: Network }): {
  [key: string]: Network
} {
  const validNetworks: { [key: string]: Network } = {}

  Object.values(networksInStorage).forEach((network) => {
    const hadValidChainId = typeof network?.chainId === 'bigint'

    // Based on the crash reports received, it turned out there are users with
    // messed-up networks in storage. So perform comprehensive validation against
    // some of the Network interface requirements
    if (sanityCheckImportantNetworkProperties(network)) {
      validNetworks[network.chainId.toString()] = network
    } else if (hadValidChainId) {
      // Attempt to replace broken network with predefined version, if available
      const predefinedNetwork = predefinedNetworks.find((n) => n.chainId === network.chainId)
      if (predefinedNetwork) validNetworks[network.chainId.toString()] = predefinedNetwork
      else {
        console.error(`Invalid network found in storage for chainId ${network.chainId}`, network)
      }
    }
  })

  return validNetworks
}

/**
 * Updates the currently stored networks with the networks coming from the relayer.
 * To determine which networks to update, it compares the predefinedConfigVersion of the stored network
 * with the relayer network. If no network is found in the storage, it adds the relayer network as a new one.
 * Even if the predefinedConfigVersion is the same or lower, some properties of the stored network should be updated.
 */
export const getNetworksUpdatedWithRelayerNetworks = (
  currentNetworks: { [key: string]: Network },
  relayerNetworks: { [key: string]: RelayerNetwork }
): { mergedNetworks: { [key: string]: Network }; updatedNetworkChainIds: Network['chainId'][] } => {
  const networks = structuredClone(currentNetworks)
  // New networks and networks with updated RPC providers
  const updatedNetworkChainIds: Network['chainId'][] = []

  Object.entries(relayerNetworks).forEach(([_chainId, network]) => {
    const chainId = BigInt(_chainId)
    const relayerNetwork = mapRelayerNetworkConfigToAmbireNetwork(chainId, network)
    const currentNetwork = networks[chainId.toString()]

    if (!currentNetwork) {
      updatedNetworkChainIds.push(relayerNetwork.chainId)
      networks[chainId.toString()] = {
        ...(predefinedNetworks.find((n) => n.chainId === relayerNetwork.chainId) || {}),
        ...relayerNetwork,
        disabled: !!relayerNetwork.disabledByDefault
      }
      return
    }

    // If the network is custom we assume predefinedConfigVersion = 0
    if (currentNetwork.predefinedConfigVersion === undefined) {
      currentNetwork.predefinedConfigVersion = 0
    }

    // Mechanism to force an update network preferences if needed
    const shouldOverrideStoredNetwork =
      relayerNetwork.predefinedConfigVersion > 0 &&
      relayerNetwork.predefinedConfigVersion > currentNetwork.predefinedConfigVersion

    if (shouldOverrideStoredNetwork) {
      updatedNetworkChainIds.push(relayerNetwork.chainId)
      networks[chainId.toString()] = {
        ...currentNetwork,
        ...relayerNetwork,
        rpcUrls: [...new Set([...relayerNetwork.rpcUrls, ...currentNetwork.rpcUrls])]
      }
      // update the selectedRpcUrl on disabledByDefault networks as we can
      // determine better which RPC is the best for our custom networks
      if (relayerNetwork.disabledByDefault)
        networks[chainId.toString()]!.selectedRpcUrl = relayerNetwork.selectedRpcUrl
    } else {
      // No need to add this network to the updated list
      // as the selectedRpcUrl is not changed and the network is
      // already in the extension
      networks[chainId.toString()] = {
        ...currentNetwork,
        rpcUrls: [...new Set([...relayerNetwork.rpcUrls, ...currentNetwork.rpcUrls])],
        suggestedRpcUrl: relayerNetwork.suggestedRpcUrl,
        suggestedRpcBatchCount: relayerNetwork.suggestedRpcBatchCount,
        refreshInterval: relayerNetwork.refreshInterval,
        iconUrls: relayerNetwork.iconUrls,
        predefined: relayerNetwork.predefined
      }
    }
  })

  // Step 3: Ensure predefined networks are marked correctly and handle special cases
  let predefinedChainIds = Object.keys(relayerNetworks)

  if (!predefinedChainIds.length) {
    predefinedChainIds = predefinedNetworks.map((network) => network.chainId.toString())
  }

  Object.keys(networks).forEach((chainId: string) => {
    if (!networks[chainId]) return

    // Remove unnecessary properties:
    if ('disabledByDefault' in networks[chainId]) {
      delete networks[chainId].disabledByDefault
    }

    const network = networks[chainId]

    // If a predefined network is removed by the relayer, mark it as custom
    // and remove the predefined flag
    // Update the hasRelayer flag to false just in case
    if (!predefinedChainIds.includes(network.chainId.toString()) && network.predefined) {
      networks[chainId] = { ...network, predefined: false, hasRelayer: false }
    }
  })

  return {
    mergedNetworks: networks,
    updatedNetworkChainIds
  }
}

export const networkChainIdToHex = (chainId: number | bigint) => {
  try {
    // Remove leading zero in hex representation
    // to match the format expected by dApps (e.g., "0xa" instead of "0x0a")
    return toBeHex(chainId).replace(/^0x0/, '0x')
  } catch (e) {
    console.log('failed to do toBeHex(chainId).replace()', e)
    return `0x${chainId.toString(16)}`
  }
}

export const getAccountNetworks = (
  networks: Network[],
  accountStates: AccountStates,
  acc?: Account | null
) => {
  if (!acc) return []

  // NOT a [Gnosis] Safe account
  if (!acc.safeCreation) {
    // EOA
    if (!acc.creation) return networks

    // v1 SA
    if (isAmbireV1LinkedAccount(acc.creation.factoryAddr)) {
      // v1s don't work without the relayer
      return networks.filter((network) => !!network.hasRelayer)
    }

    // v2 SA
    return networks.filter(
      (network) => network.areContractsDeployed && (network.hasRelayer || network.erc4337.enabled)
    )
  }
  if (!accountStates[acc.addr]) return networks

  return networks.filter((n) => {
    const networkAccState = accountStates[acc.addr]?.[n.chainId.toString()]
    if (!networkAccState) return true
    return networkAccState.isDeployed
  })
}

export const getAccountNotSupportedReason = (acc?: Account | null) => {
  if (!acc?.addr) return ''
  if (!acc.safeCreation) {
    if (!acc.creation) return '' // EOA
    if (isAmbireV1LinkedAccount(acc.creation.factoryAddr)) {
      return 'Ambire v1 accounts are not supported on this network'
    }
    // v2
    return 'Ambire smart accounts are not supported on this network'
  }
  // safe
  return 'Safe account is not activated on this network'
}

export const getSupportedNetworks = (
  networks: Network[],
  accountStates: AccountStates,
  acc?: Account | null,
  additionalCheck?: {
    chainIds: bigint[]
    reason: string
  },
  allowUndeployedSafeOnChainId?: bigint
): SupportedNetworks[] => {
  if (!acc) return []

  let checkedNetworks = networks

  // apply the additionalChecks, if any
  if (additionalCheck) {
    checkedNetworks = networks.map((n) => {
      if (!!additionalCheck.chainIds.includes(n.chainId)) return { ...n }
      return {
        ...n,
        isNotSupported: true,
        notSupportedReason: additionalCheck.reason
      }
    })
  }

  // NOT a [Gnosis] Safe account
  if (!acc.safeCreation) {
    // EOA
    if (!acc.creation) return checkedNetworks

    // v1 SA
    if (isAmbireV1LinkedAccount(acc.creation.factoryAddr)) {
      // v1s don't work without the relayer
      return checkedNetworks.map((n) => {
        if (!!n.hasRelayer) return { ...n }
        return {
          ...n,
          isNotSupported: true,
          notSupportedReason: 'Ambire v1 accounts are not supported on this network'
        }
      })
    }

    // v2 SA
    return checkedNetworks.map((n) => {
      if (n.areContractsDeployed && (n.hasRelayer || n.erc4337.enabled)) return { ...n }
      return {
        ...n,
        isNotSupported: true,
        notSupportedReason: 'Ambire smart accounts are not supported on this network'
      }
    })
  }
  if (!accountStates[acc.addr]) return checkedNetworks

  return checkedNetworks.map((n) => {
    const networkAccState = accountStates[acc.addr]?.[n.chainId.toString()]
    const isSafeSupportedOnNetwork =
      !networkAccState || networkAccState.isDeployed || n.chainId === allowUndeployedSafeOnChainId

    if (isSafeSupportedOnNetwork) return { ...n }
    return {
      ...n,
      isNotSupported: true,
      notSupportedReason: 'Safe account is not activated on this network'
    }
  })
}
