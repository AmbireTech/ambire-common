import { Contract, JsonRpcProvider } from 'ethers'

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
import { getSASupport } from '../deployless/simulateDeployCall'

export const getNetworksWithFailedRPC = ({ providers }: { providers: RPCProviders }): string[] => {
  return Object.keys(providers).filter((networkId) => !providers[networkId].isWorking)
}

export async function getNetworkInfo(rpcUrl: string, chainId: bigint) {
  const provider = new JsonRpcProvider(rpcUrl)
  const [entryPointCode, singletonCode, oracleCode, factoryCode, hasBundler, block, saSupport] =
    await Promise.all([
      provider.getCode(ERC_4337_ENTRYPOINT),
      provider.getCode(SINGLETON),
      provider.getCode(OPTIMISTIC_ORACLE),
      provider.getCode(AMBIRE_ACCOUNT_FACTORY),
      Bundler.isNetworkSupported(chainId),
      provider.getBlock('latest'),
      getSASupport(provider)
    ])

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
  const hasSimulations = saSupport.supportsStateOverride

  return {
    isSAEnabled,
    isOptimistic,
    hasSimulations,
    erc4337,
    areContractsDeployed,
    feeOptions
  }
}

// call this if you have the network props already calculated
export function getFeaturesByNetworkProperties(
  isSAEnabled: boolean,
  hasSimulations: boolean,
  erc4337: NetworkDescriptor['erc4337'],
  areContractsDeployed: boolean,
  hasRelayer: boolean
) {
  const features = []
  if (!isSAEnabled) {
    features.push({
      id: 'saSupport',
      level: 'danger',
      msg: 'Smart accounts are not available on this network. Please do not send funds to your smart account or they may be lost forever'
    })
  }

  if (isSAEnabled && areContractsDeployed) {
    features.push({
      id: 'saSupport',
      level: 'success',
      msg: 'Smart accounts are available on this network'
    })
  } else if (isSAEnabled && !areContractsDeployed) {
    features.push({
      id: 'saSupport',
      level: 'warning',
      msg: "Ambire's smart contracts are not deployed on this network. To use a smart account, please deploy them from network settings using a Basic account"
    })
  }

  const supportsFeeTokens = isSAEnabled && (hasRelayer || erc4337.hasPaymaster)
  features.push({
    id: 'feeTokens',
    level: supportsFeeTokens ? 'success' : 'warning',
    msg: supportsFeeTokens
      ? 'You can pay network fees for smart accounts in tokens'
      : "Only the network's native token can be used as a fee with smart accounts for this network"
  })

  features.push({
    id: 'simulation',
    level: hasSimulations ? 'success' : 'danger',
    msg: hasSimulations
      ? 'Transaction simulation is supported by the selected network RPC'
      : 'Transaction simulation is not supported by the selected network RPC. Please change it to use simulations'
  })

  return features
}

// call this if you have only the rpcUrl and chainId
// this method makes an RPC request, calculates the network info and returns the features
export async function getFeatures(rpcUrl: string, chainId: bigint, hasRelayer: boolean) {
  const { isSAEnabled, hasSimulations, erc4337, areContractsDeployed } = await getNetworkInfo(
    rpcUrl,
    chainId
  )

  return getFeaturesByNetworkProperties(
    isSAEnabled,
    hasSimulations,
    erc4337.erc4337,
    areContractsDeployed,
    hasRelayer
  )
}
