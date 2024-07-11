/* eslint-disable @typescript-eslint/no-floating-promises */

import { describe, expect, test } from '@jest/globals'

import { NetworkInfo } from '../../interfaces/network'
import { getFeaturesByNetworkProperties } from './networks'

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
    const results = getFeaturesByNetworkProperties(networkInfo)
    const saSupport = results.find((sup) => sup.id === 'saSupport')
    expect(saSupport?.msg).toBe(
      'We were unable to detect smart account support on the network with the provided RPC. Please choose another RPC or try again later.'
    )

    networkInfo.hasSingleton = false
    const results2 = getFeaturesByNetworkProperties(networkInfo)
    const saSupport2 = results2.find((sup) => sup.id === 'saSupport')
    expect(saSupport2?.msg).toBe(
      "Unfortunately this network doesn't support smart contract wallets. It can be used only with Basic accounts (EOAs)."
    )
  })
})
