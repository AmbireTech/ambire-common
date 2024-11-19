/* eslint-disable import/no-extraneous-dependencies */

import { AMBIRE_ACCOUNT_FACTORY, OPTIMISTIC_ORACLE, SINGLETON } from '../../consts/deploy'
import { networks as predefinedNetworks } from '../../consts/networks'
import { Fetch } from '../../interfaces/fetch'
import {
  Network,
  NetworkFeature,
  NetworkId,
  NetworkInfo,
  NetworkInfoLoading
} from '../../interfaces/network'
import { RPCProviders } from '../../interfaces/provider'
import { Bundler } from '../../services/bundlers/bundler'
import { getRpcProvider } from '../../services/provider'
import { getSASupport } from '../deployless/simulateDeployCall'
import { doesItSupportStateOverride } from '../deployless/supportsStateOverride'

// bnb, fantom, metis
const relayerAdditionalNetworks = [56n, 250n, 1088n]

export const getNetworksWithFailedRPC = ({ providers }: { providers: RPCProviders }): string[] => {
  return Object.keys(providers).filter(
    (networkId) =>
      typeof providers[networkId].isWorking === 'boolean' && !providers[networkId].isWorking
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

export async function getNetworkInfo(
  fetch: Fetch,
  rpcUrl: string,
  chainId: bigint,
  callback: (networkInfo: NetworkInfoLoading<NetworkInfo>) => void
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
          retryRequest(() => doesItSupportStateOverride(provider)),
          Bundler.isNetworkSupported(fetch, chainId).catch(() => false)
          // retryRequest(() => provider.getCode(ERC_4337_ENTRYPOINT)),
        ]).catch((e: Error) =>
          raiseFlagged(e, ['0x', '0x', { addressMatches: false, supportsStateOverride: false }])
        )
        const [singletonCode, factoryCode, saSupport, supportsStateOverride, is4337enabled] =
          responses
        const areContractsDeployed = factoryCode !== '0x'
        // const has4337 = entryPointCode !== '0x' && hasBundler
        const predefinedNetwork = predefinedNetworks.find((net) => net.chainId === chainId)
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
          rpcNoStateOverride:
            predefinedNetwork && predefinedNetwork.rpcNoStateOverride === true
              ? true
              : !supportsStateOverride,
          erc4337: {
            enabled: predefinedNetwork ? predefinedNetwork.erc4337.enabled : is4337enabled,
            hasPaymaster: predefinedNetwork ? predefinedNetwork.erc4337.hasPaymaster : false
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

// call this if you have the network props already calculated
export function getFeaturesByNetworkProperties(
  networkInfo: NetworkInfo | NetworkInfoLoading<NetworkInfo> | undefined
): NetworkFeature[] {
  const features: NetworkFeature[] = [
    {
      id: 'saSupport',
      title: "Ambire's smart wallets",
      level: 'loading'
    },
    {
      id: 'simulation',
      title: 'Transaction simulation',
      level: 'loading'
    },
    {
      id: 'prices',
      title: "Token's prices",
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
    chainId,
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
        msg: 'We were unable to fetch the network information with the provided RPC. Please choose another RPC or try again later'
      }
    ]
  }

  if ([isSAEnabled, areContractsDeployed, erc4337, hasSingleton].every((p) => p !== 'LOADING')) {
    if (!isSAEnabled) {
      updateFeature('saSupport', {
        level: 'danger',
        title: 'Smart contract wallets are not supported',
        msg: hasSingleton
          ? 'We were unable to detect smart account support on the network with the provided RPC. Please choose another RPC or try again later.'
          : "Unfortunately this network doesn't support smart contract wallets. It can be used only with Basic accounts (EOAs)."
      })
    }

    const predefinedNetSettings = predefinedNetworks.find((net) => net.chainId === chainId)
    const erc4337Settings = predefinedNetSettings ? predefinedNetSettings?.erc4337 : erc4337
    const title = (erc4337Settings as any)?.enabled
      ? "Ambire's smart wallets via ERC-4337 Account Abstraction"
      : "Ambire's smart wallets"

    if (isSAEnabled && areContractsDeployed) {
      updateFeature('saSupport', {
        title,
        level: 'success',
        msg: "This blockchain network support smart accounts and Ambire Wallet's contacts are deployed."
      })
    } else if (isSAEnabled && !areContractsDeployed) {
      updateFeature('saSupport', {
        title,
        level: 'warning',
        msg: "This network supports smart contract wallets, but Ambire Wallet's contracts are not yet deployed. You can deploy them by using a Basic account and the Deploy contracts option to unlock the Smart accounts feature. If not, only Basic accounts (EOAs) can be used on this network."
      })
    }
  }

  if ([rpcNoStateOverride].every((p) => p !== 'LOADING')) {
    const isPredefinedNetwork = predefinedNetworks.find((net) => net.chainId === chainId)
    if (!rpcNoStateOverride && isPredefinedNetwork) {
      updateFeature('simulation', {
        level: 'success',
        title: 'Transaction simulation is fully supported',
        msg: 'This feature offers a proactive approach to blockchain security by a process used to predict the outcome of a transaction before it is broadcasted to the blockchain.'
      })
    } else if (!rpcNoStateOverride) {
      updateFeature('simulation', {
        level: 'warning',
        title: 'Transaction simulation is partially supported',
        msg: 'Our security feature of predicting the outcome of a transaction before it is broadcasted to the blockchain is not fully functioning. The reasons might be a network or RPC limitations. You can try a different RPC.'
      })
    } else {
      updateFeature('simulation', {
        level: 'danger',
        title: 'Transaction simulation is not supported',
        msg: 'Unfortunately, the feature of predicting the outcome of a transaction before it is broadcasted to the blockchain is not yet available for this network or RPC. You can try a different RPC.'
      })
    }
  }

  if (nativeAssetId !== 'LOADING') {
    const hasNativeAssetId = nativeAssetId && nativeAssetId !== ''
    updateFeature('prices', {
      level: hasNativeAssetId ? 'success' : 'danger',
      msg: hasNativeAssetId
        ? 'We are using third-party providers in order to present you with information about current token prices, and it supports most of the popular tokens.'
        : "Our third-party providers don't support this blockchain network yet and we cannot present you with information of current token prices on this network."
    })
  }

  return features
}

// call this if you have only the rpcUrls and chainId
// this method makes an RPC request, calculates the network info and returns the features
export function getFeatures(
  networkInfo: NetworkInfoLoading<NetworkInfo> | undefined
): NetworkFeature[] {
  return getFeaturesByNetworkProperties(networkInfo)
}

// Since v4.24.0, a new Network interface has been introduced,
// that replaces the old NetworkDescriptor, NetworkPreference, and CustomNetwork.
// Previously, only NetworkPreferences were stored, with other network properties
// being calculated in a getter each time the networks were needed.
// Now, all network properties are pre-calculated and stored in a structured format: { [key: NetworkId]: Network } in the storage.
// This function migrates the data from the old NetworkPreferences to the new structure
// to ensure compatibility and prevent breaking the extension after updating to v4.24.0
export async function migrateNetworkPreferencesToNetworks(networkPreferences: {
  [key: NetworkId]: Partial<Network>
}) {
  const predefinedNetworkIds = predefinedNetworks.map((n) => n.id)
  const customNetworkIds = Object.keys(networkPreferences).filter(
    (k) => !predefinedNetworkIds.includes(k)
  )

  const networksToStore: { [key: NetworkId]: Network } = {}

  predefinedNetworks.forEach((n) => {
    networksToStore[n.id] = n
  })
  customNetworkIds.forEach((networkId: NetworkId) => {
    const preference = networkPreferences[networkId]
    const networkInfo = {
      chainId: preference.chainId!,
      isSAEnabled: preference.isSAEnabled ?? false,
      isOptimistic: preference.isOptimistic ?? false,
      rpcNoStateOverride: preference.rpcNoStateOverride ?? true,
      erc4337: preference.erc4337 ?? { enabled: false, hasPaymaster: false },
      areContractsDeployed: preference.areContractsDeployed ?? false,
      feeOptions: { is1559: (preference as any).is1559 ?? false },
      platformId: preference.platformId ?? '',
      nativeAssetId: preference.nativeAssetId ?? '',
      flagged: preference.flagged ?? false,
      hasSingleton: preference.hasSingleton ?? false
    }
    delete (preference as any).is1559
    networksToStore[networkId] = {
      id: networkId,
      ...preference,
      ...networkInfo,
      features: getFeaturesByNetworkProperties(networkInfo),
      hasRelayer: relayerAdditionalNetworks.includes(preference.chainId!),
      predefined: false
    } as Network
  })

  return networksToStore
}
