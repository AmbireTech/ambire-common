/* eslint-disable @typescript-eslint/no-floating-promises */

import { AddNetworkRequestParams, NetworkInfo } from 'interfaces/network'

import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { NetworksController } from './networks'

describe('Networks Controller', () => {
  let networksController: NetworksController
  beforeEach(() => {
    networksController = new NetworksController(
      produceMemoryStore(),
      () => {},
      () => {}
    )
  })

  test('should update network preferences', (done) => {
    const preferences = {
      rpcUrls: ['https://eth-mainnet.alchemyapi.io/v2/123abc123abc123abc123abc123abcde'],
      explorerUrl: 'https://etherscan.io/custom'
    }

    let checkComplete = false
    networksController.onUpdate(() => {
      if (networksController.statuses.updateNetwork === 'SUCCESS' && !checkComplete) {
        const modifiedNetwork = networksController.networks.find(({ id }) => id === 'ethereum')
        expect(modifiedNetwork?.explorerUrl).toEqual('https://etherscan.io/custom')
        expect(modifiedNetwork?.rpcUrls).toEqual([
          'https://eth-mainnet.alchemyapi.io/v2/123abc123abc123abc123abc123abcde'
        ])
        checkComplete = true
        done()
      }
    })

    networksController.updateNetwork(preferences, 'ethereum')
  })

  test('should add the mantle network as a custom network', (done) => {
    let checks = 0
    let mantleNetwork: null | AddNetworkRequestParams = null
    networksController.onUpdate(() => {
      if (checks === 0) {
        expect(networksController.networkToAddOrUpdate?.chainId).toBe(5000n)
        const networkInfoLoading = networksController.networkToAddOrUpdate?.info
        if (!networkInfoLoading) return

        const isLoading = Object.values(networkInfoLoading).some((v) => v === 'LOADING')
        if (isLoading) return
        const mantleNetworkInfo: NetworkInfo = networkInfoLoading as NetworkInfo
        // mantle has the entry point uploaded
        expect(mantleNetworkInfo?.erc4337.enabled).toBe(true)
        expect(mantleNetworkInfo?.erc4337.hasPaymaster).toBe(false)
        // has smart accounts
        expect(mantleNetworkInfo?.isSAEnabled).toBe(true)

        // contracts are deployed
        expect(mantleNetworkInfo?.areContractsDeployed).toBe(true)
        // is not 1559
        expect(mantleNetworkInfo?.feeOptions!.is1559).toBe(true)

        // mantle is optimistic
        expect(mantleNetworkInfo?.isOptimistic).toBe(true)
        // coingecko
        expect(mantleNetworkInfo?.platformId).toBe('mantle')
        expect(mantleNetworkInfo?.nativeAssetId).toBe('mantle')
        // simulation is somewhat supported
        expect(mantleNetworkInfo?.rpcNoStateOverride).toBe(false)
        expect(mantleNetworkInfo?.hasDebugTraceCall).toBe(false)
        mantleNetwork = {
          name: 'Mantle',
          rpcUrls: [networksController.networkToAddOrUpdate?.rpcUrl],
          selectedRpcUrl: networksController.networkToAddOrUpdate?.rpcUrl,
          nativeAssetSymbol: 'MNT',
          explorerUrl: 'https://explorer.mantle.xyz/',
          ...mantleNetworkInfo,
          feeOptions: mantleNetworkInfo.feeOptions ?? {
            is1559: false
          },
          bundlerUrl: '',
          iconUrls: []
        } as AddNetworkRequestParams

        checks++
        networksController.addNetwork(mantleNetwork)
      }

      if (checks === 1) {
        const noUpdate = networksController.networkToAddOrUpdate
        if (noUpdate !== null) return

        checks++
        const mantle = networksController.networks.find((net) => net.id === 'mantle')
        expect(mantle).not.toBe(null)
        expect(mantle).not.toBe(undefined)

        // contracts are not deployed
        const saSupport = mantle?.features.find((feat) => feat.id === 'saSupport')
        expect(saSupport).not.toBe(null)
        expect(saSupport).not.toBe(undefined)
        expect(saSupport!.level).toBe('warning')
        expect(saSupport!.title).toBe("Ambire's smart wallets via ERC-4337 Account Abstraction")

        // somewhat simulation
        const simulation = mantle?.features.find((feat) => feat.id === 'simulation')
        expect(simulation).not.toBe(null)
        expect(simulation).not.toBe(undefined)
        expect(simulation!.level).toBe('warning')

        // has token prices
        const prices = mantle?.features.find((feat) => feat.id === 'prices')
        expect(prices).not.toBe(null)
        expect(prices).not.toBe(undefined)
        expect(prices!.level).toBe('success')

        networksController.updateNetwork({ areContractsDeployed: true }, 'mantle')
      }

      // test to see if updateNetwork is working
      if (checks === 2) {
        const mantle = networksController.networks.find((net) => net.id === 'mantle')
        expect(mantle?.areContractsDeployed).toBe(true)
        done()
      }
    })

    // TODO: errors
    // let errorEmits = 0
    // networksController.onError(() => {
    //   console.log(networksController.emittedErrors)
    //   if (errorEmits === 0) {
    //     const errors = networksController.emittedErrors
    //     expect(errors.length).toEqual(1)
    //     expect(errors[0].message).toEqual(
    //       'Failed to detect network, perhaps an RPC issue. Please change the RPC and try again'
    //     )
    //   }
    //   if (errorEmits === 1) {
    //     const errors = networksController.emittedErrors
    //     expect(errors.length).toEqual(2)
    //     expect(errors[1].message).toEqual(
    //       'Failed to detect network, perhaps an RPC issue. Please change the RPC and try again'
    //     )
    //   }
    //   errorEmits++
    //   if (errorEmits === 3) {
    //     done()
    //   }
    // })

    networksController.setNetworkToAddOrUpdate({
      rpcUrl: 'https://mantle-mainnet.public.blastapi.io',
      chainId: 5000n
    })
  })

  // TODO: Refactor Fantom test as well
  // test('should add the fantom network as a custom network', (done) => {
  //   let updateEmits = 0
  //   networksController.onUpdate(() => {
  //     if (updateEmits === 0) {
  //       updateEmits++
  //       return
  //     }

  //     if (updateEmits === 1) {
  //       updateEmits++
  //       const fantomNetwork = networksController.networks.find(({ id }) => id === 'fantom')
  //       expect(fantomNetwork).not.toBe(undefined)
  //       expect(fantomNetwork).not.toBe(null)
  //       expect(fantomNetwork?.chainId).toBe(250n)
  //       expect(fantomNetwork?.name).toBe('Fantom')
  //       expect(fantomNetwork?.id).toBe('fantom')
  //       expect(fantomNetwork?.nativeAssetSymbol).toBe('FTM')

  //       // fantom does not have the entry point
  //       expect(fantomNetwork?.erc4337?.enabled).toBe(false)
  //       expect(fantomNetwork?.erc4337?.hasPaymaster).toBe(false)

  //       // ...nor does it have the singleton
  //       expect(fantomNetwork?.isSAEnabled).toBe(true)

  //       // so contracts are not deployed
  //       expect(fantomNetwork?.areContractsDeployed).toBe(false)

  //       // it is 1559
  //       expect(fantomNetwork?.feeOptions.is1559).toBe(true)

  //       // it is not optimistic
  //       expect(fantomNetwork?.isOptimistic).toBe(false)

  //       // simulation is somewhat supported
  //       expect(fantomNetwork?.rpcNoStateOverride).toBe(false)
  //       expect(fantomNetwork?.hasDebugTraceCall).toBe(false)

  //       // coingecko
  //       expect(fantomNetwork?.platformId).toBe('fantom')
  //       expect(fantomNetwork?.nativeAssetId).toBe('fantom')

  //       // contracts are not deployed
  //       const saSupport = fantomNetwork?.features.find((feat) => feat.id === 'saSupport')
  //       expect(saSupport).not.toBe(null)
  //       expect(saSupport).not.toBe(undefined)
  //       expect(saSupport!.level).toBe('warning')

  //       // no fee tokens
  //       const noFeeTokens = fantomNetwork?.features.find((feat) => feat.id === 'feeTokens')
  //       expect(noFeeTokens).not.toBe(null)
  //       expect(noFeeTokens).not.toBe(undefined)
  //       expect(noFeeTokens!.level).toBe('warning')

  //       // somewhat simulation
  //       const simulation = fantomNetwork?.features.find((feat) => feat.id === 'simulation')
  //       expect(simulation).not.toBe(null)
  //       expect(simulation).not.toBe(undefined)
  //       expect(simulation!.level).toBe('warning')
  //     }

  //     done()
  //   })

  //   networksController.addNetwork({
  //     name: 'Fantom',
  //     chainId: 250n,
  //     explorerUrl: 'https://ftmscan.com/',
  //     nativeAssetSymbol: 'FTM',
  //     rpcUrls: ['https://fantom-pokt.nodies.app']
  //   })
  // })
})
