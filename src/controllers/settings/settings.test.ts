/* eslint-disable @typescript-eslint/no-floating-promises */

import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { NetworkInfo } from '../../interfaces/networkDescriptor'
import { CustomNetwork } from '../../interfaces/settings'
import { SettingsController } from './settings'

describe('Settings Controller', () => {
  let settingsController: SettingsController
  beforeEach(() => {
    settingsController = new SettingsController(produceMemoryStore())
  })

  test('should throw if adding an account preference is requested with invalid address', (done) => {
    let emitCounter = 0
    settingsController.onError(() => {
      emitCounter++

      if (emitCounter === 1) {
        const errors = settingsController.emittedErrors
        expect(errors.length).toEqual(1)
        done()
      }
    })

    settingsController.addAccountPreferences({
      '0x-invalid-address': { label: 'test', pfp: 'whatever' }
    })
  })

  test('should add account preferences', (done) => {
    const validAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    const preferences = { label: 'Ivo', pfp: 'racing_car' }

    let emitCounter = 0
    settingsController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        // Cast to AccountPreferences, because TS doesn't know that we just added a preference
        expect(settingsController.accountPreferences[validAddress]).toEqual(preferences)
        done()
      }
    })

    settingsController.addAccountPreferences({ [validAddress]: preferences })
  })

  test('should selectively update only the preferences provided, if one already exists', (done) => {
    const validAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    const preferences = { label: 'Dancho', pfp: 'puzel' }
    const preferencesWithLabelUpdateOnly = { label: 'Kalo' }

    let emitCounter = 0
    settingsController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 2) {
        // Cast to AccountPreferences, because TS doesn't know that we just added a preference
        expect(settingsController.accountPreferences[validAddress].label).toEqual(
          preferencesWithLabelUpdateOnly.label
        )
        expect(settingsController.accountPreferences[validAddress].pfp).toEqual(preferences.pfp)
        done()
      }
    })

    settingsController.addAccountPreferences({ [validAddress]: preferences })
    // @ts-ignore TypeScript complains, but that's okay, because we're testing
    settingsController.addAccountPreferences({ [validAddress]: preferencesWithLabelUpdateOnly })
  })

  test('should remove address preference', (done) => {
    const validAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    const preferences = { label: 'Ivo', pfp: 'racing_car' }

    let emitCounter = 0
    settingsController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        settingsController.removeAccountPreferences([validAddress])
      }

      if (emitCounter === 2) {
        // Cast to AccountPreferences, because TS doesn't know that we just added a preference
        expect(settingsController.accountPreferences[validAddress]).toBeUndefined()
        done()
      }
    })

    settingsController.addAccountPreferences({ [validAddress]: preferences })
  })

  test('should throw if adding a key preference is requested with invalid address', (done) => {
    let emitCounter = 0
    settingsController.onError(() => {
      emitCounter++

      if (emitCounter === 1) {
        expect(settingsController.emittedErrors.length).toEqual(1)
        done()
      }
    })

    settingsController.addKeyPreferences([
      { addr: '0x-invalid-address', type: 'internal', label: 'test' }
    ])
  })

  test('should add key preferences', (done) => {
    const validRandomAddress1 = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    const validRandomAddress2 = '0xb14c95D1844D5d8B00166e46338F5Fc9546DF9D5'
    const preference1 = { addr: validRandomAddress1, type: 'internal', label: "Kalo's mini key" }
    const preference2 = { addr: validRandomAddress2, type: 'ledger', label: "Kalo's large key" }

    let emitCounter = 0
    settingsController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        expect(settingsController.keyPreferences).toContainEqual(preference1)
        expect(settingsController.keyPreferences).toContainEqual(preference2)
        done()
      }
    })

    settingsController.addKeyPreferences([preference1, preference2])
  })

  test('should remove key preference', (done) => {
    const validAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    const preference = { addr: validAddress, type: 'internal', label: 'Narnia key' }

    let emitCounter = 0
    settingsController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        settingsController.removeKeyPreferences([preference])
      }

      if (emitCounter === 2) {
        expect(settingsController.keyPreferences).not.toContainEqual(preference)
        done()
      }
    })

    settingsController.addKeyPreferences([preference])
  })

  test('should update network preferences', (done) => {
    const preferences = {
      rpcUrls: ['https://eth-mainnet.alchemyapi.io/v2/123abc123abc123abc123abc123abcde'],
      explorerUrl: 'https://etherscan.io/custom'
    }

    let checkComplete = false
    settingsController.onUpdate(() => {
      if (settingsController.statuses.updateNetworkPreferences === 'SUCCESS' && !checkComplete) {
        const modifiedNetwork = settingsController.networks.find(({ id }) => id === 'ethereum')
        expect(modifiedNetwork?.explorerUrl).toEqual('https://etherscan.io/custom')
        expect(modifiedNetwork?.rpcUrls).toEqual([
          'https://eth-mainnet.alchemyapi.io/v2/123abc123abc123abc123abc123abcde'
        ])
        settingsController.providers.ethereum.destroy()
        checkComplete = true
        done()
      }
    })

    settingsController.updateNetworkPreferences(preferences, 'ethereum')
  })

  test('should reset network preferences', (done) => {
    const ethereumStatic = networks.find(({ id }) => id === 'ethereum')
    const modifiedNetwork = settingsController.networks.find(({ id }) => id === 'ethereum')

    let emitCounter = 0
    settingsController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        settingsController.resetNetworkPreference('rpcUrls', 'ethereum')
      }
      if (emitCounter === 3) {
        expect(modifiedNetwork?.rpcUrls).toEqual(ethereumStatic?.rpcUrls)
        expect(modifiedNetwork?.explorerUrl).toEqual('https://etherscan.io/custom') // Should remain the same
      }
      done()
    })

    settingsController.updateNetworkPreferences(
      {
        rpcUrls: ['https://eth-mainnet.alchemyapi.io/v2/123abc123abc123abc123abc123abcde'],
        explorerUrl: 'https://etherscan.io/custom'
      },
      'ethereum'
    )
  })

  test('should check if network features get displayed correctly for ethereum', (done) => {
    let checks = 0
    settingsController.onUpdate(() => {
      if (checks === 4) {
        checks++
        const eth = settingsController.networks.find((net) => net.id === 'ethereum')!
        expect(eth.areContractsDeployed).toBe(true)
        done()
      }

      // skip updates until the correct one comes
      if (checks === 2 || checks === 3) {
        checks++
      }

      if (checks === 1) {
        checks++
        const eth = settingsController.networks.find((net) => net.id === 'ethereum')!
        expect(eth.areContractsDeployed).toBe(false)
        settingsController.setContractsDeployedToTrueIfDeployed(eth)
      }

      // skip the first update: LOADING
      if (checks === 0) {
        checks++
      }
    })

    const eth = settingsController.networks.find((net) => net.id === 'ethereum')!
    expect(eth?.features.length).toBe(3)

    const saSupport = eth?.features.find((feat) => feat.id === 'saSupport')!
    expect(saSupport).not.toBe(null)
    expect(saSupport).not.toBe(undefined)
    expect(saSupport!.level).toBe('success')
    expect(saSupport!.title).toBe("Ambire's smart wallets")

    const simulation = eth?.features.find((feat) => feat.id === 'simulation')
    expect(simulation).not.toBe(null)
    expect(simulation).not.toBe(undefined)
    expect(simulation!.level).toBe('success')

    const prices = eth?.features.find((feat) => feat.id === 'prices')
    expect(prices).not.toBe(null)
    expect(prices).not.toBe(undefined)
    expect(prices!.level).toBe('success')

    // set first to false so we could test setContractsDeployedToTrueIfDeployed
    settingsController.updateNetworkPreferences({ areContractsDeployed: false }, 'ethereum')
  })

  test('should add the mantle network as a custom network', (done) => {
    let checks = 0
    let mantleNetwork: null | CustomNetwork = null
    settingsController.onUpdate(() => {
      if (checks === 0) {
        expect(settingsController.networkToAddOrUpdate?.chainId).toBe(5000n)
        const networkInfoLoading = settingsController.networkToAddOrUpdate?.info
        if (!networkInfoLoading) return

        let isLoading = false
        // eslint-disable-next-line no-restricted-syntax
        for (const [, value] of Object.entries(networkInfoLoading)) {
          if (value === 'LOADING') {
            isLoading = true
            break
          }
        }

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
          rpcUrls: [settingsController.networkToAddOrUpdate?.rpcUrl],
          nativeAssetSymbol: 'MNT',
          explorerUrl: 'https://explorer.mantle.xyz/',
          ...mantleNetworkInfo,
          feeOptions: mantleNetworkInfo.feeOptions ?? {
            is1559: false
          }
        } as CustomNetwork

        checks++
        settingsController.addCustomNetwork(mantleNetwork)
      }

      if (checks === 1) {
        const noUpdate = settingsController.networkToAddOrUpdate
        if (noUpdate !== null) return

        checks++
        const mantle = settingsController.networks.find((net) => net.id === 'mantle')
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

        settingsController.updateNetworkPreferences({ areContractsDeployed: true }, 'mantle')
      }

      // test to see if updateNetworkPreferences is working
      if (checks === 2) {
        checks++
        const mantle = settingsController.networks.find((net) => net.id === 'mantle')
        expect(mantle?.areContractsDeployed).toBe(true)
        done()
      }
    })

    // TODO: errors
    // let errorEmits = 0
    // settingsController.onError(() => {
    //   console.log(settingsController.emittedErrors)
    //   if (errorEmits === 0) {
    //     const errors = settingsController.emittedErrors
    //     expect(errors.length).toEqual(1)
    //     expect(errors[0].message).toEqual(
    //       'Failed to detect network, perhaps an RPC issue. Please change the RPC and try again'
    //     )
    //   }
    //   if (errorEmits === 1) {
    //     const errors = settingsController.emittedErrors
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

    settingsController.setNetworkToAddOrUpdate({
      rpcUrl: 'https://rpc.mantle.xyz',
      chainId: 5000n
    })
  })

  // TODO: Refactor Fantom test as well
  // test('should add the fantom network as a custom network', (done) => {
  //   let updateEmits = 0
  //   settingsController.onUpdate(() => {
  //     if (updateEmits === 0) {
  //       updateEmits++
  //       return
  //     }

  //     if (updateEmits === 1) {
  //       updateEmits++
  //       const fantomNetwork = settingsController.networks.find(({ id }) => id === 'fantom')
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

  //   settingsController.addCustomNetwork({
  //     name: 'Fantom',
  //     chainId: 250n,
  //     explorerUrl: 'https://ftmscan.com/',
  //     nativeAssetSymbol: 'FTM',
  //     rpcUrls: ['https://fantom-pokt.nodies.app']
  //   })
  // })
})
