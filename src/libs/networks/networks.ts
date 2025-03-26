/* eslint-disable import/no-extraneous-dependencies */

import { AMBIRE_ACCOUNT_FACTORY, OPTIMISTIC_ORACLE, SINGLETON } from '../../consts/deploy'
import { Fetch } from '../../interfaces/fetch'
import {
  Erc4337settings,
  Network,
  NetworkFeature,
  NetworkInfo,
  NetworkInfoLoading
} from '../../interfaces/network'
import { RPCProviders } from '../../interfaces/provider'
import { Bundler } from '../../services/bundlers/bundler'
import { getRpcProvider } from '../../services/provider'
import { getSASupport } from '../deployless/simulateDeployCall'

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
  if (network && network.predefined) return network.erc4337.enabled

  // this will be true in this case
  return hasBundlerSupport
}

export const getNetworksWithFailedRPC = ({ providers }: { providers: RPCProviders }): string[] => {
  return Object.keys(providers).filter(
    (chainId) => typeof providers[chainId].isWorking === 'boolean' && !providers[chainId].isWorking
  )
}

async function retryRequest(init: Function, counter = 0): Promise<any> {
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

/**
 * Fetches detailed network information from an RPC provider.
 * Used when adding a new network, updating network info, or when the RPC provider is changed,
 * And once every 24 hours for custom networks.
 *
 * - Checks smart account (SA) support, singleton contract, and state override capabilities.
 * - Determines if the network supports ERC-4337 and Account Abstraction.
 * - Fetches additional metadata from external sources (e.g., CoinGecko).
 */
export async function getNetworkInfo(
  fetch: Fetch,
  rpcUrl: string,
  chainId: bigint,
  callback: (networkInfo: NetworkInfoLoading<NetworkInfo>) => void,
  network: Network | undefined
) {
  let networkInfo: NetworkInfoLoading<NetworkInfo> = {
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
  callback(networkInfo)

  const timeout = (time: number = 30000): Promise<'timeout reached'> => {
    return new Promise((resolve) => {
      setTimeout(resolve, time, 'timeout reached')
    }) as unknown as Promise<'timeout reached'>
  }

  let flagged = false
  const provider = getRpcProvider([rpcUrl], chainId)

  const raiseFlagged = (e: Error, returnData: any): any => {
    if (e.message === 'flagged') {
      flagged = true
    }

    return returnData
  }

  const info = await Promise.race([
    Promise.all([
      (async () => {
        const responses = await Promise.all([
          retryRequest(() => provider.getCode(SINGLETON)),
          retryRequest(() => provider.getCode(AMBIRE_ACCOUNT_FACTORY)),
          retryRequest(() => getSASupport(provider)),
          Bundler.isNetworkSupported(fetch, chainId).catch(() => false)
          // retryRequest(() => provider.getCode(ERC_4337_ENTRYPOINT)),
        ]).catch((e: Error) =>
          raiseFlagged(e, ['0x', '0x', { addressMatches: false, supportsStateOverride: false }])
        )
        const [singletonCode, factoryCode, saSupport, hasBundlerSupport] = responses
        const areContractsDeployed = factoryCode !== '0x'
        // const has4337 = entryPointCode !== '0x' && hasBundler

        // Ambire support is as follows:
        // - either the addresses match after simulation, that's perfect
        // - or we can't do the simulation with this RPC but we have the factory
        // deployed on the network
        const supportsAmbire =
          saSupport.addressMatches || (!saSupport.supportsStateOverride && areContractsDeployed)
        networkInfo = {
          ...networkInfo,
          hasSingleton: singletonCode !== '0x',
          isSAEnabled: supportsAmbire && singletonCode !== '0x',
          areContractsDeployed,
          rpcNoStateOverride:
            network && network.rpcNoStateOverride === true
              ? true
              : !saSupport.supportsStateOverride,
          erc4337: {
            enabled: is4337Enabled(hasBundlerSupport, network),
            hasPaymaster: network ? network.erc4337.hasPaymaster : false,
            hasBundlerSupport
          }
        }

        callback(networkInfo)
      })(),
      (async () => {
        const oracleCode = await retryRequest(() => provider.getCode(OPTIMISTIC_ORACLE)).catch(
          (e: Error) => raiseFlagged(e, '0x')
        )
        const isOptimistic = oracleCode !== '0x'

        networkInfo = { ...networkInfo, isOptimistic }

        callback(networkInfo)
      })(),
      (async () => {
        const block = await retryRequest(() => provider.getBlock('latest')).catch((e: Error) =>
          raiseFlagged(e, null)
        )
        const feeOptions = { is1559: block?.baseFeePerGas !== null }

        networkInfo = { ...networkInfo, feeOptions }

        callback(networkInfo)
      })(),
      (async () => {
        const coingeckoRequest = await fetch(
          `https://cena.ambire.com/api/v3/platform/${Number(chainId)}`
        ).catch(() => ({
          error: 'currently, we cannot fetch the coingecko information'
        }))
        // set the coingecko info
        let platformId = null
        let nativeAssetId = null
        if (!('error' in coingeckoRequest)) {
          const coingeckoInfo = await coingeckoRequest.json()
          if (!coingeckoInfo.error) {
            platformId = coingeckoInfo.platformId
            nativeAssetId = coingeckoInfo.nativeAssetId
          }
        }
        networkInfo = { ...networkInfo, platformId, nativeAssetId }

        callback(networkInfo)
      })()
    ]),
    timeout()
  ])

  networkInfo = { ...networkInfo, flagged: flagged || info === 'timeout reached' }
  callback(networkInfo)

  provider.destroy()
}

/**
 * Determines supported features for a network based on its properties.
 *
 * Smart Accounts, ERC-4337, transaction simulation, and price tracking are supported.
 */
// call this if you have the network props already calculated
export function getFeaturesByNetworkProperties(
  networkInfo: NetworkInfo | NetworkInfoLoading<NetworkInfo> | undefined,
  network?: Network
): NetworkFeature[] {
  const features: NetworkFeature[] = [
    {
      id: 'saSupport',
      title: 'Ambire Smart Accounts',
      level: 'loading'
    },
    {
      id: 'simulation',
      title: 'Transaction simulation',
      level: 'loading'
    },
    {
      id: 'prices',
      title: 'Token prices',
      level: 'loading'
    }
  ]

  if (!networkInfo) return features.map((f) => ({ ...f, level: 'initial' }))

  const {
    flagged,
    isSAEnabled,
    areContractsDeployed,
    erc4337,
    rpcNoStateOverride,
    nativeAssetId,
    hasSingleton
  } = networkInfo

  const updateFeature = (
    id: string,
    update: {
      msg: string
      title?: string
      level: 'success' | 'danger' | 'warning' | 'loading'
    }
  ) => {
    const foundFeature = features.find((f) => f.id === id)

    if (foundFeature) {
      Object.assign(foundFeature, update)
    }
  }
  if (flagged && flagged !== 'LOADING') {
    return [
      {
        id: 'flagged',
        title: 'RPC error',
        level: 'danger',
        msg: 'We were unable to fetch the network information with the provided RPC. Try choosing a different RPC.'
      }
    ]
  }

  if ([isSAEnabled, areContractsDeployed, erc4337, hasSingleton].every((p) => p !== 'LOADING')) {
    const canBroadcast = (erc4337 as Erc4337settings).enabled || network?.hasRelayer

    if (!isSAEnabled || !canBroadcast) {
      updateFeature('saSupport', {
        level: 'danger',
        title: 'Smart contract wallets are not supported',
        msg: hasSingleton
          ? 'We were unable to detect Smart Account support on the network with the provided RPC. Try choosing a different RPC.'
          : 'Unfortunately, this network doesn’t support Smart Accounts. It can be used only with Basic Accounts (EOAs).'
      })
    }

    const erc4337Settings = {
      enabled: is4337Enabled((erc4337 as Erc4337settings).enabled, network),
      hasPaymaster: network
        ? network.erc4337.hasPaymaster
        : (erc4337 as Erc4337settings).hasPaymaster
    }

    const title = (erc4337Settings as any)?.enabled
      ? 'Ambire Smart Accounts via ERC-4337 (Account Abstraction)'
      : 'Ambire Smart Accounts'

    if (canBroadcast && isSAEnabled && areContractsDeployed) {
      updateFeature('saSupport', {
        title,
        level: 'success',
        msg: "This network supports Smart Accounts, and Ambire Wallet's smart contracts are deployed."
      })
    } else if (canBroadcast && isSAEnabled && !areContractsDeployed) {
      updateFeature('saSupport', {
        title,
        level: 'warning',
        msg: "This network supports Smart Accounts, but Ambire Wallet's contracts have not yet been deployed. You can deploy them by using a Basic Account and the Deploy contracts option to unlock the Smart Accounts feature. Otherwise, only Basic Accounts (EOAs) can be used on this network."
      })
    }
  }

  if ([rpcNoStateOverride].every((p) => p !== 'LOADING')) {
    const isPredefinedNetwork = network?.predefined
    if (!rpcNoStateOverride && isPredefinedNetwork) {
      updateFeature('simulation', {
        level: 'success',
        title: 'Transaction simulation is fully supported',
        msg: 'Transaction simulation helps predict the outcome of a transaction and your future account balance before it’s broadcasted to the blockchain, enhancing security.'
      })
    } else if (!rpcNoStateOverride) {
      updateFeature('simulation', {
        level: 'warning',
        title: 'Transaction simulation is partially supported',
        msg: 'Transaction simulation, one of our security features that predicts the outcome of a transaction before it is broadcast to the blockchain, is not fully functioning on this chain. The reasons might be network or RPC limitations. Try choosing a different RPC.'
      })
    } else {
      updateFeature('simulation', {
        level: 'danger',
        title: 'Transaction simulation is not supported',
        msg: "Transaction simulation helps predict the outcome of a transaction and your future account balance before it’s broadcasted to the blockchain, enhancing security. Unfortunately, this feature isn't available for the current network or RPC. Try choosing a different RPC."
      })
    }
  }

  if (nativeAssetId !== 'LOADING') {
    const hasNativeAssetId = nativeAssetId && nativeAssetId !== ''
    updateFeature('prices', {
      level: hasNativeAssetId ? 'success' : 'danger',
      msg: hasNativeAssetId
        ? 'We pull token price information in real-time using third-party providers.'
        : "Our third-party providers don't support this network yet, so we cannot show token prices."
    })
  }

  return features
}

// call this if you have only the rpcUrls and chainId
// this method makes an RPC request, calculates the network info and returns the features
export function getFeatures(
  networkInfo: NetworkInfoLoading<NetworkInfo> | undefined,
  network: Network | undefined
): NetworkFeature[] {
  return getFeaturesByNetworkProperties(networkInfo, network)
}

export function hasRelayerSupport(network: Network) {
  return (
    network.hasRelayer || !!relayerAdditionalNetworks.find((net) => net.chainId === network.chainId)
  )
}
