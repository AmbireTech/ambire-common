/* eslint-disable import/no-extraneous-dependencies */

import { Contract, JsonRpcProvider } from 'ethers'
import fetch from 'node-fetch'

import EntryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import {
  AMBIRE_ACCOUNT_FACTORY,
  AMBIRE_PAYMASTER,
  ERC_4337_ENTRYPOINT,
  OPTIMISTIC_ORACLE,
  SINGLETON
} from '../../consts/deploy'
import { NetworkFeature, NetworkInfo, NetworkInfoLoading } from '../../interfaces/networkDescriptor'
import { RPCProviders } from '../../interfaces/settings'
import { Bundler } from '../../services/bundlers/bundler'
import wait from '../../utils/wait'
import { getSASupport, simulateDebugTraceCall } from '../deployless/simulateDeployCall'

export const getNetworksWithFailedRPC = ({ providers }: { providers: RPCProviders }): string[] => {
  return Object.keys(providers).filter((networkId) => !providers[networkId].isWorking)
}

export async function getNetworkInfo(
  rpcUrl: string,
  chainId: bigint,
  callback: (networkInfo: NetworkInfoLoading<NetworkInfo>) => void
) {
  let networkInfo: NetworkInfoLoading<NetworkInfo> = {
    isSAEnabled: 'LOADING',
    isOptimistic: 'LOADING',
    rpcNoStateOverride: 'LOADING',
    erc4337: 'LOADING',
    areContractsDeployed: 'LOADING',
    feeOptions: 'LOADING',
    hasDebugTraceCall: 'LOADING',
    platformId: 'LOADING',
    nativeAssetId: 'LOADING',
    flagged: 'LOADING'
  }
  callback(networkInfo)

  const provider = new JsonRpcProvider(rpcUrl)
  const timeout = (): Promise<'timeout reached'> => {
    return new Promise((resolve) => {
      setTimeout(resolve, 30000, 'timeout reached')
    }) as unknown as Promise<'timeout reached'>
  }

  const info = await Promise.race([
    Promise.all([
      (async () => {
        const responses = await Promise.all([
          provider.getCode(ERC_4337_ENTRYPOINT).catch(() => '0x'),
          Bundler.isNetworkSupported(chainId).catch(() => false)
        ])
        const [entryPointCode, hasBundler] = responses
        const has4337 = entryPointCode !== '0x' && hasBundler
        let hasPaymaster = false
        if (has4337) {
          const entryPoint = new Contract(ERC_4337_ENTRYPOINT, EntryPointAbi, provider)
          const paymasterBalance = await entryPoint.balanceOf(AMBIRE_PAYMASTER)
          hasPaymaster = paymasterBalance.toString() > 0
        }
        networkInfo = {
          ...networkInfo,
          erc4337: { enabled: has4337, hasPaymaster }
        }

        callback(networkInfo)
      })(),
      (async () => {
        await wait(1000)
        const responses = await Promise.all([
          provider.getCode(SINGLETON).catch(() => '0x'),
          provider.getCode(AMBIRE_ACCOUNT_FACTORY).catch(() => '0x'),
          getSASupport(provider)
        ])
        const [singletonCode, factoryCode, saSupport] = responses
        const areContractsDeployed = factoryCode !== '0x'
        // Ambire support is as follows:
        // - either the addresses match after simulation, that's perfect
        // - or we can't do the simulation with this RPC but we have the factory
        // deployed on the network
        const supportsAmbire =
          saSupport.addressMatches || (!saSupport.supportsStateOverride && areContractsDeployed)
        networkInfo = {
          ...networkInfo,
          isSAEnabled: supportsAmbire && singletonCode !== '0x',
          areContractsDeployed,
          rpcNoStateOverride: !saSupport.supportsStateOverride
        }

        callback(networkInfo)
      })(),
      (async () => {
        await wait(1500)
        const oracleCode = await provider.getCode(OPTIMISTIC_ORACLE).catch(() => '0x')
        const isOptimistic = oracleCode !== '0x'

        networkInfo = { ...networkInfo, isOptimistic }

        callback(networkInfo)
      })(),
      (async () => {
        await wait(2000)
        const block = await provider.getBlock('latest').catch(() => null)
        const feeOptions = { is1559: block?.baseFeePerGas !== null }

        networkInfo = { ...networkInfo, feeOptions }

        callback(networkInfo)
      })(),
      (async () => {
        await wait(2500)
        const hasDebugTraceCall = await simulateDebugTraceCall(provider)
        networkInfo = { ...networkInfo, hasDebugTraceCall }

        callback(networkInfo)
      })(),
      (async () => {
        await wait(3000)
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

  networkInfo = { ...networkInfo, flagged: info === 'timeout reached' }
  callback(networkInfo)

  provider.destroy()
}

// call this if you have the network props already calculated
export function getFeaturesByNetworkProperties(
  networkInfo: NetworkInfo | NetworkInfoLoading<NetworkInfo> | undefined,
  hasRelayer: boolean
): NetworkFeature[] {
  const features: NetworkFeature[] = [
    {
      id: 'saSupport',
      title: "Support Ambire's smart wallets",
      level: 'loading'
    },
    {
      id: 'feeTokens',
      title: 'Gas abstraction',
      level: 'loading'
    },
    {
      id: 'simulation',
      title: 'Transaction simulation',
      level: 'loading'
    },
    {
      id: 'erc4337',
      title: 'ERC-4337 Account Abstraction',
      level: 'loading'
    },
    {
      id: 'prices',
      title: "Token's prices",
      level: 'loading'
    }
  ]

  if (!networkInfo) return features

  const {
    flagged,
    isSAEnabled,
    areContractsDeployed,
    erc4337,
    rpcNoStateOverride,
    hasDebugTraceCall,
    nativeAssetId
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

  if ([isSAEnabled, areContractsDeployed].every((p) => p !== 'LOADING')) {
    if (!isSAEnabled) {
      updateFeature('saSupport', {
        level: 'danger',
        title: 'Smart contract wallets are not supported',
        msg: "Unfortunately this blockchain network don't support smart contract wallets. This network can be used only with Basic accounts (EOAs)."
      })
    }

    if (isSAEnabled && areContractsDeployed) {
      updateFeature('saSupport', {
        level: 'success',
        msg: "This blockchain network support smart accounts and Ambire Wallet's contacts are deployed."
      })
    } else if (isSAEnabled && !areContractsDeployed) {
      updateFeature('saSupport', {
        level: 'warning',
        msg: "This network support smart contract wallets, but Ambire Wallet's contracts are not yet deployed. You can deploy them by using a Basic account and Deploy contracts option and unlock Smart accounts feature. If not, it can be used only with Basic accounts (EOAs)."
      })
    }
  }

  if ([isSAEnabled, erc4337].every((p) => p !== 'LOADING')) {
    const supportsFeeTokens = isSAEnabled && (hasRelayer || (erc4337 as any).hasPaymaster)
    updateFeature('feeTokens', {
      level: supportsFeeTokens ? 'success' : 'warning',
      title: supportsFeeTokens
        ? 'Gas abstraction is supported'
        : 'Gas abstraction is not available',
      msg: supportsFeeTokens
        ? 'This feature allows you to pay gas fees in a variety of ERC-20 tokens, in addition to the native one, making transaction fees a more flexible and effortless experience.'
        : 'This feature is not supported by the network and you can pay the gas fees only with the native token.'
    })

    updateFeature('erc4337', {
      level: (erc4337 as any).enabled ? 'success' : 'warning',
      title: (erc4337 as any).enabled
        ? 'ERC-4337 Account Abstraction is supported'
        : 'ERC-4337 Account Abstraction is not supported',
      msg: (erc4337 as any).enabled
        ? 'ERC-4337 simplifies the logic used by smart contract wallets, and allows wallets to focus primarily on the core smart account functionalities (a.k.a. Account Abstraction)'
        : 'Unfortunately, ERC-4337 is not supported on this network. '
    })
  }

  if ([rpcNoStateOverride, hasDebugTraceCall].every((p) => p !== 'LOADING')) {
    if (!rpcNoStateOverride && hasDebugTraceCall) {
      updateFeature('simulation', {
        level: 'success',
        title: 'Transaction simulation is fully supported',
        msg: 'This feature offers a proactive approach to blockchain security by a process used to predict the outcome of a transaction before it is broadcasted to the blockchain.'
      })
    } else if (!rpcNoStateOverride && !hasDebugTraceCall) {
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

  if (nativeAssetId && nativeAssetId !== 'LOADING') {
    const hasNativeAssetId = nativeAssetId !== ''
    updateFeature('prices', {
      level: hasNativeAssetId ? 'success' : 'danger',
      msg: hasNativeAssetId
        ? 'We are using third-party providers in order to present you with information about current token prices, and it supports most of the popular tokens.'
        : "Our third-party providers don't support this blockchain network yet and we cannot present you with information of current token prices on this network."
    })
  }

  return features
}

// call this if you have only the rpcUrl and chainId
// this method makes an RPC request, calculates the network info and returns the features
export function getFeatures(
  networkInfo: NetworkInfoLoading<NetworkInfo> | undefined,
  hasRelayer: boolean
): NetworkFeature[] {
  return getFeaturesByNetworkProperties(networkInfo, hasRelayer)
}
