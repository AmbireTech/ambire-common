import { describe, expect, jest, test } from '@jest/globals'

import { networks as predefinedNetworks } from '../../consts/networks'
import { Network, NetworkInfo, RelayerNetwork } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { getRpcProvider } from '../../services/provider'
import {
  getFeaturesByNetworkProperties,
  getNetworksUpdatedWithRelayerNetworks,
  getStateOverrideSupport
} from './networks'

const getByKey = <T>(record: Record<string, T>, key: string): T => {
  const value = record[key]
  if (value === undefined) throw new Error(`Missing test fixture for key ${key}`)

  return value
}

describe('Networks lib', () => {
  describe('State override support', () => {
    test('returns false for Etherlink', async () => {
      const provider = getRpcProvider(['https://rpc.ankr.com/etherlink_mainnet'], 42793n)

      try {
        await expect(getStateOverrideSupport(provider)).resolves.toBe(false)
      } finally {
        provider.destroy()
      }
    }, 30000)

    test('returns true for Ethereum', async () => {
      const provider = getRpcProvider(['https://ethereum-rpc.publicnode.com'], 1n)

      try {
        await expect(getStateOverrideSupport(provider)).resolves.toBe(true)
      } finally {
        provider.destroy()
      }
    }, 30000)

    test('returns false when the RPC rejects the call', async () => {
      const provider = {
        send: jest.fn<() => Promise<string>>().mockRejectedValue(new Error('unsupported'))
      } as unknown as RPCProvider

      await expect(getStateOverrideSupport(provider)).resolves.toBe(false)
    })

    test('returns false for an unexpected successful response', async () => {
      const provider = {
        send: jest.fn<() => Promise<string>>().mockResolvedValue('0x1')
      } as unknown as RPCProvider

      await expect(getStateOverrideSupport(provider)).resolves.toBe(false)
    })
  })

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
        "Unfortunately, this network doesn't support Smart Accounts. It can be used only with EOA accounts."
      )
    })
  })
  describe('getNetworksUpdatedWithRelayerNetworks works', () => {
    it('Only predefined networks are stored and so all new relayer networks should be added', () => {
      const { mergedNetworks: result } = getNetworksUpdatedWithRelayerNetworks(
        networksObj,
        MOCK_RELAYER_NETWORKS
      )
      const network2 = getByKey(result, '2')
      const network3 = getByKey(result, '3')

      expect(result).toHaveProperty('2')
      expect(network2.chainId).toBe(2n)
      expect(network2.predefined).toBe(false)
      expect(network2.disabled).toBe(true)

      expect(result).toHaveProperty('3')
      expect(network3.chainId).toBe(3n)
      expect(network3.predefined).toBe(true)
      expect(network3.disabled).toBe(false)
    })
    describe('disabledByDefault works as expected', () => {
      it('If the network is not stored, it should be added as disabled', () => {
        const { mergedNetworks: result } = getNetworksUpdatedWithRelayerNetworks(
          networksObj,
          MOCK_RELAYER_NETWORKS
        )
        const network2 = getByKey(result, '2')

        expect(result).toHaveProperty('2')
        expect(network2.disabled).toBe(true)
      })
      it('If the network is stored and enabled, it should remain enabled', () => {
        const relayerNetworksClone = structuredClone(MOCK_RELAYER_NETWORKS)
        getByKey(relayerNetworksClone, '1').disabledByDefault = true
        const { mergedNetworks: result } = getNetworksUpdatedWithRelayerNetworks(
          networksObj,
          relayerNetworksClone
        )
        const network1 = getByKey(result, '1')

        expect(result).toHaveProperty('1')
        expect(network1.disabled).toBeFalsy()
        expect(network1.predefinedConfigVersion).toBe(3)
      })
    })
    it('The stored network should be updated if predefinedConfigVersion is higher in the relayer network', () => {
      const { mergedNetworks: result1 } = getNetworksUpdatedWithRelayerNetworks(
        networksObj,
        MOCK_RELAYER_NETWORKS
      )
      const network1BeforeUpdate = getByKey(result1, '1')

      expect(result1).toHaveProperty('1')
      expect(network1BeforeUpdate.predefinedConfigVersion).toBe(3)
      expect(network1BeforeUpdate.erc4337.defaultBundler).not.toBe('gelatov2')

      const relayerNetworksClone = structuredClone(MOCK_RELAYER_NETWORKS)
      const relayerNetwork1 = getByKey(relayerNetworksClone, '1')
      relayerNetwork1.predefinedConfigVersion = 4
      relayerNetwork1.smartAccounts!.erc4337.defaultBundler = 'gelatov2'

      const { mergedNetworks: result2 } = getNetworksUpdatedWithRelayerNetworks(
        result1,
        relayerNetworksClone
      )
      const network1AfterUpdate = getByKey(result2, '1')

      expect(result2).toHaveProperty('1')
      expect(network1AfterUpdate.predefinedConfigVersion).toBe(4)
      expect(network1AfterUpdate.erc4337.defaultBundler).toBe('gelatov2')
      expect(network1AfterUpdate.disabled).toBeFalsy()
    })
    it('Even if predefinedConfigVersion is the same or lower, some properties of the stored network should be updated', () => {
      const { mergedNetworks: result1 } = getNetworksUpdatedWithRelayerNetworks(
        networksObj,
        MOCK_RELAYER_NETWORKS
      )
      const network1BeforeUpdate = getByKey(result1, '1')

      expect(result1).toHaveProperty('1')
      expect(network1BeforeUpdate.rpcUrls).toEqual(getByKey(networksObj, '1').rpcUrls)
      expect(network1BeforeUpdate.iconUrls).toEqual(['1', '2'])
      expect(network1BeforeUpdate.predefined).toBe(true)
      expect(network1BeforeUpdate.feeOptions.is1559).toBe(true)

      const relayerNetworksClone = structuredClone(MOCK_RELAYER_NETWORKS)
      const relayerNetwork1 = getByKey(relayerNetworksClone, '1')
      relayerNetwork1.rpcUrls = ['https://new-rpc-url.com']
      relayerNetwork1.iconUrls = ['https://new-icon-url.com']
      relayerNetwork1.refreshInterval = 1000
      // This property shouldn't be updated as predefinedConfigVersion is the same
      relayerNetwork1.feeOptions.is1559 = false

      const { mergedNetworks: result2 } = getNetworksUpdatedWithRelayerNetworks(
        result1,
        relayerNetworksClone
      )
      const network1AfterUpdate = getByKey(result2, '1')

      expect(result2).toHaveProperty('1')
      // Rpc urls are added to the existing ones
      expect(network1AfterUpdate.rpcUrls).toEqual([
        'https://new-rpc-url.com',
        'https://invictus.ambire.com/ethereum'
      ])
      // Icon urls are replaced
      expect(network1AfterUpdate.iconUrls).toEqual(['https://new-icon-url.com'])
      expect(network1AfterUpdate.refreshInterval).toBe(1000)
      expect(network1AfterUpdate.predefined).toBe(true)
      // Fee options are not updated as predefinedConfigVersion is the same
      expect(network1AfterUpdate.feeOptions.is1559).toBe(true)
    })
    it("Unnecessary properties from the relayer network shouldn't be stored", () => {
      const { mergedNetworks: result } = getNetworksUpdatedWithRelayerNetworks(
        networksObj,
        MOCK_RELAYER_NETWORKS
      )
      const ethereum = getByKey(result, '1')

      expect(ethereum).not.toHaveProperty('disabledByDefault')
      expect(ethereum).not.toHaveProperty('smartAccounts')
      expect(ethereum).not.toHaveProperty('ambireId')
      expect(ethereum).toHaveProperty('predefinedConfigVersion', 3)
      expect(ethereum.chainId).toBe(1n)
    })
    it('If a predefined network is removed by the relayer, some of its properties should be updated', () => {
      const relayerNetworksClone = structuredClone(MOCK_RELAYER_NETWORKS)
      const relayerNetwork2 = getByKey(relayerNetworksClone, '2')

      relayerNetwork2.predefinedConfigVersion = 1
      relayerNetwork2.disabledByDefault = false
      relayerNetwork2.smartAccounts!.hasRelayer = true

      const { mergedNetworks: result1 } = getNetworksUpdatedWithRelayerNetworks(
        networksObj,
        relayerNetworksClone
      )
      const network2BeforeUpdate = getByKey(result1, '2')

      expect(result1).toHaveProperty('2')
      expect(network2BeforeUpdate.predefined).toBe(true)
      expect(network2BeforeUpdate.hasRelayer).toBe(true)

      delete relayerNetworksClone['2']

      const { mergedNetworks: result2 } = getNetworksUpdatedWithRelayerNetworks(
        result1,
        relayerNetworksClone
      )
      const network2AfterUpdate = getByKey(result2, '2')

      expect(result2).toHaveProperty('2')
      expect(network2AfterUpdate.predefined).toBe(false)
      expect(network2AfterUpdate.hasRelayer).toBe(false)
    })
    it('Disabled networks remain disabled despite updates from the relayer', () => {
      const { mergedNetworks: result1 } = getNetworksUpdatedWithRelayerNetworks(
        networksObj,
        MOCK_RELAYER_NETWORKS
      )
      const network2BeforeUpdate = getByKey(result1, '2')

      expect(result1).toHaveProperty('2')
      expect(network2BeforeUpdate.disabled).toBe(true)

      const relayerNetworksClone = structuredClone(MOCK_RELAYER_NETWORKS)
      const relayerNetwork2 = getByKey(relayerNetworksClone, '2')

      relayerNetwork2.predefinedConfigVersion = 2
      relayerNetwork2.disabledByDefault = false

      const { mergedNetworks: result2 } = getNetworksUpdatedWithRelayerNetworks(
        result1,
        relayerNetworksClone
      )
      const network2AfterUpdate = getByKey(result2, '2')

      expect(result2).toHaveProperty('2')
      expect(network2AfterUpdate.disabled).toBe(true)
      expect(network2AfterUpdate.predefinedConfigVersion).toBe(2)
    })
    it('An empty relayer networks object should not change the stored networks', () => {
      const { mergedNetworks: result1 } = getNetworksUpdatedWithRelayerNetworks(networksObj, {})

      expect(result1).toEqual(networksObj)
    })
    it("Custom networks (ones that aren't passed by the relayer) should not be affected", () => {
      const customNetwork: Network = {
        ...network,
        chainId: 999n,
        name: 'Custom Network',
        rpcUrls: ['https://custom-rpc.com'],
        selectedRpcUrl: 'https://custom-rpc.com',
        predefined: false
      }

      const { mergedNetworks: result1 } = getNetworksUpdatedWithRelayerNetworks(
        { ...networksObj, '999': customNetwork },
        MOCK_RELAYER_NETWORKS
      )
      const network999 = getByKey(result1, '999')

      expect(result1).toHaveProperty('999')
      expect(network999.chainId).toBe(999n)
      expect(network999.name).toBe('Custom Network')
      expect(network999.rpcUrls).toEqual(['https://custom-rpc.com'])
    })
    it('networksObj reference should not be modified', () => {
      expect(NEVER_MUTATE_NETWORKS_OBJ).toEqual(networksObj)
    })
    ;[0, -1, Number.POSITIVE_INFINITY].forEach((refreshInterval) => {
      it(`Invalid refreshInterval values should not be added to networks: ${refreshInterval}`, () => {
        const relayerNetworksClone = structuredClone(MOCK_RELAYER_NETWORKS)
        getByKey(relayerNetworksClone, '1').refreshInterval = refreshInterval

        const { mergedNetworks: result } = getNetworksUpdatedWithRelayerNetworks(
          networksObj,
          relayerNetworksClone
        )

        expect(getByKey(result, '1').refreshInterval).toBeUndefined()
      })
    })
  })
})

const network: Network = {
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
  disableEstimateGas: true
}

const networksObj = predefinedNetworks.reduce<Record<string, Network>>((acc, n) => {
  acc[n.chainId.toString()] = network
  return acc
}, {})

const mockRelayerNetworks = () => {
  const clonedNetworksObj = structuredClone(networksObj)
  const clonedEthereumNetwork = getByKey(clonedNetworksObj, '1')
  const ethereumNetwork = getByKey(networksObj, '1')
  const relayerNets: {
    [key: string]: RelayerNetwork
  } = {}

  const MOCK_NATIVE = {
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    wrapped: {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      chainId: 1n,
      coingeckoId: 'ethereum',
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
      icon: ''
    },
    coingeckoId: 'ethereum',
    icon: ''
  } as RelayerNetwork['native']

  relayerNets['1'] = {
    ...clonedEthereumNetwork,
    predefinedConfigVersion: 3,
    ambireId: 'mock-chain-id-1',
    native: MOCK_NATIVE,
    iconUrls: ['1', '2'],
    chainId: 1,
    smartAccounts: {
      hasRelayer: ethereumNetwork.hasRelayer,
      erc4337: ethereumNetwork.erc4337
    }
  } as RelayerNetwork

  relayerNets['2'] = {
    ...clonedEthereumNetwork,
    predefinedConfigVersion: 1,
    disabledByDefault: true,
    ambireId: 'mock-chain-id-2',
    native: MOCK_NATIVE,
    iconUrls: ['1', '2'],
    chainId: 2,
    smartAccounts: {
      hasRelayer: ethereumNetwork.hasRelayer,
      erc4337: ethereumNetwork.erc4337
    }
  } as RelayerNetwork

  relayerNets['3'] = {
    ...clonedEthereumNetwork,
    predefinedConfigVersion: 2,
    ambireId: 'mock-chain-id-3',
    native: MOCK_NATIVE,
    iconUrls: ['1', '2'],
    chainId: 3,
    isOptimistic: false
  } as RelayerNetwork

  return relayerNets
}

const MOCK_RELAYER_NETWORKS = mockRelayerNetworks()
const NEVER_MUTATE_NETWORKS_OBJ = structuredClone(networksObj)
