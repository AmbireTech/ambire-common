import { Contract, JsonRpcProvider } from 'ethers'

import EntryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import {
  AMBIRE_ACCOUNT_FACTORY,
  AMBIRE_PAYMASTER,
  ERC_4337_ENTRYPOINT,
  OPTIMISTIC_ORACLE,
  SINGLETON
} from '../../consts/deploy'
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
