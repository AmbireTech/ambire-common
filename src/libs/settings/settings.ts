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
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { RPCProviders } from '../../interfaces/settings'
import { Bundler } from '../../services/bundlers/bundler'
import { getSASupport, simulateDebugTraceCall } from '../deployless/simulateDeployCall'

export type NetworkFeature = {
  id: string
  level: 'success' | 'danger' | 'warning'
  msg: string
}

export const getNetworksWithFailedRPC = ({ providers }: { providers: RPCProviders }): string[] => {
  return Object.keys(providers).filter((networkId) => !providers[networkId].isWorking)
}

export async function getNetworkInfo(rpcUrl: string, chainId: bigint) {
  const provider = new JsonRpcProvider(rpcUrl)
  const timeout = () => {
    return new Promise((resolve) => {
      setTimeout(resolve, 20000, 'timeout reached')
    })
  }
  const networkRequests = await Promise.race([
    Promise.all([
      provider.getCode(ERC_4337_ENTRYPOINT).catch(() => '0x'),
      provider.getCode(SINGLETON).catch(() => '0x'),
      provider.getCode(OPTIMISTIC_ORACLE).catch(() => '0x'),
      provider.getCode(AMBIRE_ACCOUNT_FACTORY).catch(() => '0x'),
      Bundler.isNetworkSupported(chainId).catch(() => false),
      provider.getBlock('latest').catch(() => null),
      getSASupport(provider),
      simulateDebugTraceCall(provider),
      fetch(`https://cena.ambire.com/api/v3/platform/${Number(chainId)}`).catch(() => ({
        error: 'currently, we cannot fetch the coingecko information'
      }))
    ]),
    timeout()
  ])

  // if it can't execute the requests for 20 seconds, we flag the RPC
  if (typeof networkRequests === 'string' && networkRequests === 'timeout reached') {
    return {
      isSAEnabled: false,
      isOptimistic: false,
      rpcNoStateOverride: true,
      erc4337: { erc4337: { enabled: false, hasPaymaster: false } },
      areContractsDeployed: false,
      feeOptions: null,
      hasDebugTraceCall: false,
      platformId: '',
      nativeAssetId: '',
      flagged: true
    }
  }

  // @ts-ignore
  const [
    entryPointCode,
    singletonCode,
    oracleCode,
    factoryCode,
    hasBundler,
    block,
    saSupport,
    hasDebugTraceCall,
    coingeckoRequest
  ] = networkRequests

  const has4337 = entryPointCode !== '0x' && hasBundler
  const areContractsDeployed = factoryCode !== '0x'
  let hasPaymaster = false
  if (has4337) {
    const entryPoint = new Contract(ERC_4337_ENTRYPOINT, EntryPointAbi, provider)
    const paymasterBalance = await entryPoint.balanceOf(AMBIRE_PAYMASTER)
    hasPaymaster = paymasterBalance.toString() > 0
  }
  const erc4337 = { erc4337: { enabled: has4337, hasPaymaster } }
  const feeOptions = { feeOptions: { is1559: block?.baseFeePerGas !== null } }

  // Ambire support is as follows:
  // - either the addresses match after simulation, that's perfect
  // - or we can't do the simulation with this RPC but we have the factory
  // deployed on the network
  const supportsAmbire =
    saSupport.addressMatches || (!saSupport.supportsStateOverride && areContractsDeployed)

  const isSAEnabled = supportsAmbire && singletonCode !== '0x'
  const isOptimistic = oracleCode !== '0x'

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

  return {
    isSAEnabled,
    isOptimistic,
    rpcNoStateOverride: !saSupport.supportsStateOverride,
    erc4337,
    areContractsDeployed,
    feeOptions,
    hasDebugTraceCall,
    platformId,
    nativeAssetId,
    flagged: false
  }
}

// call this if you have the network props already calculated
export function getFeaturesByNetworkProperties(
  isSAEnabled: boolean,
  rpcNoStateOverride: boolean,
  erc4337: NetworkDescriptor['erc4337'],
  areContractsDeployed: boolean,
  hasRelayer: boolean,
  hasDebugTraceCall: boolean,
  flagged: boolean
) {
  const features: NetworkFeature[] = []
  if (flagged) {
    features.push({
      id: 'flagged',
      level: 'danger',
      msg: 'We were unable to fetch the network information with the provided RPC. Please choose another RPC or try again later'
    })
    return features
  }

  if (!isSAEnabled) {
    features.push({
      id: 'saSupport',
      level: 'danger',
      msg: 'Smart accounts are not available on this network. Please do not send funds to your smart account or they may be lost forever.'
    })
  }

  if (isSAEnabled && areContractsDeployed) {
    features.push({
      id: 'saSupport',
      level: 'success',
      msg: 'Smart accounts are available on this network.'
    })
  } else if (isSAEnabled && !areContractsDeployed) {
    features.push({
      id: 'saSupport',
      level: 'warning',
      msg: "Ambire's smart contracts are not deployed on this network. To use a smart account, please deploy them from network settings using a Basic account."
    })
  }

  const supportsFeeTokens = isSAEnabled && (hasRelayer || erc4337.hasPaymaster)
  features.push({
    id: 'feeTokens',
    level: supportsFeeTokens ? 'success' : 'warning',
    msg: supportsFeeTokens
      ? 'You can pay network fees for smart accounts in tokens.'
      : "Only the network's native token can be used as a fee with smart accounts for this network."
  })

  if (!rpcNoStateOverride && hasDebugTraceCall) {
    features.push({
      id: 'simulation',
      level: 'success',
      msg: 'Transaction simulation is fully supported.'
    })
  } else if (!rpcNoStateOverride && !hasDebugTraceCall) {
    features.push({
      id: 'simulation',
      level: 'warning',
      msg: 'Transaction simulation is somewhat supported. You can try changing the RPC to resolve this issue.'
    })
  } else {
    features.push({
      id: 'simulation',
      level: 'danger',
      msg: 'Transaction simulation is not supported. Please change the RPC to use simulations.'
    })
  }

  return features
}

// call this if you have only the rpcUrl and chainId
// this method makes an RPC request, calculates the network info and returns the features
export async function getFeatures(rpcUrl: string, chainId: bigint, hasRelayer: boolean) {
  const {
    isSAEnabled,
    rpcNoStateOverride,
    erc4337,
    areContractsDeployed,
    hasDebugTraceCall,
    flagged
  } = await getNetworkInfo(rpcUrl, chainId)

  return getFeaturesByNetworkProperties(
    isSAEnabled,
    rpcNoStateOverride,
    erc4337.erc4337,
    areContractsDeployed,
    hasRelayer,
    hasDebugTraceCall,
    flagged
  )
}
