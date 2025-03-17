/* eslint-disable @typescript-eslint/no-floating-promises */

import { describe, expect, test } from '@jest/globals'

import { NetworkInfo } from '../../interfaces/network'
import { getFeaturesByNetworkProperties } from './networks'

const network = {
  id: 'ethereum',
  name: 'Ethereum',
  nativeAssetSymbol: 'ETH',
  has7702: false,
  nativeAssetName: 'Ether',
  rpcUrls: ['https://invictus.ambire.com/ethereum'],
  selectedRpcUrl: 'https://invictus.ambire.com/ethereum',
  rpcNoStateOverride: false,
  chainId: 1n,
  explorerUrl: 'https://etherscan.io',
  erc4337: { enabled: false, hasPaymaster: true, hasBundlerSupport: true },
  isSAEnabled: true,
  areContractsDeployed: true,
  hasRelayer: true,
  platformId: 'ethereum',
  nativeAssetId: 'ethereum',
  hasSingleton: true,
  features: [],
  feeOptions: { is1559: true },
  predefined: true,
  wrappedAddr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  disableEstimateGas: true,
  allowForce4337: true
}

describe('Network features', () => {
  test('should check if valid messages for smart account support get shown depending on the network properties', async () => {
    const networkInfo: NetworkInfo = {
      chainId: 1n,
      isSAEnabled: false,
      hasSingleton: true,
      isOptimistic: false,
      rpcNoStateOverride: false,
      erc4337: { enabled: true, hasPaymaster: true },
      areContractsDeployed: true,
      feeOptions: { is1559: true },
      platformId: 'ethereum',
      nativeAssetId: 'ethereum',
      flagged: false
    }
    const results = getFeaturesByNetworkProperties(networkInfo, network)
    const saSupport = results.find((sup) => sup.id === 'saSupport')
    expect(saSupport?.msg).toBe(
      'We were unable to detect Smart Account support on the network with the provided RPC. Try choosing a different RPC.'
    )

    networkInfo.hasSingleton = false
    const results2 = getFeaturesByNetworkProperties(networkInfo, network)
    const saSupport2 = results2.find((sup) => sup.id === 'saSupport')
    expect(saSupport2?.msg).toBe(
      'Unfortunately, this network doesn’t support Smart Accounts. It can be used only with Basic Accounts (EOAs).'
    )
  })
})
