/* eslint-disable @typescript-eslint/no-floating-promises */

import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { networks } from '../../consts/networks'
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
      rpcUrl: 'https://eth-mainnet.alchemyapi.io/v2/123abc123abc123abc123abc123abcde',
      explorerUrl: 'https://etherscan.io/custom'
    }

    let emitCounter = 0
    settingsController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        const modifiedNetwork = settingsController.networks.find(({ id }) => id === 'ethereum')
        expect(modifiedNetwork?.explorerUrl).toEqual('https://etherscan.io/custom')
        expect(modifiedNetwork?.rpcUrl).toEqual(
          'https://eth-mainnet.alchemyapi.io/v2/123abc123abc123abc123abc123abcde'
        )
        settingsController.providers.ethereum.destroy()
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
        settingsController.resetNetworkPreference('rpcUrl', 'ethereum')
      }
      if (emitCounter === 3) {
        expect(modifiedNetwork?.rpcUrl).toEqual(ethereumStatic?.rpcUrl)
        expect(modifiedNetwork?.explorerUrl).toEqual('https://etherscan.io/custom') // Should remain the same
      }
      done()
    })

    settingsController.updateNetworkPreferences(
      {
        rpcUrl: 'https://eth-mainnet.alchemyapi.io/v2/123abc123abc123abc123abc123abcde',
        explorerUrl: 'https://etherscan.io/custom'
      },
      'ethereum'
    )
  })

  test('should check if network features get displayed correctly for ethereum', () => {
    const eth = settingsController.networks.find((net) => net.id === 'ethereum')
    expect(eth).not.toBe(null)
    expect(eth?.features.length).toBe(3)

    const saSupport = eth?.features.find((feat) => feat.id === 'saSupport')
    expect(saSupport).not.toBe(null)
    expect(saSupport).not.toBe(undefined)
    expect(saSupport!.level).toBe('success')

    const noFeeTokens = eth?.features.find((feat) => feat.id === 'feeTokens')
    expect(noFeeTokens).not.toBe(null)
    expect(noFeeTokens).not.toBe(undefined)
    expect(noFeeTokens!.level).toBe('success')

    const simulation = eth?.features.find((feat) => feat.id === 'simulation')
    expect(simulation).not.toBe(null)
    expect(simulation).not.toBe(undefined)
    expect(simulation!.level).toBe('success')
  })

  test('should add the mantle network as a custom network', (done) => {
    let checks = 0
    let updateEmits = 0
    settingsController.onUpdate(() => {
      if (updateEmits === 0) {
        updateEmits++
        return
      }

      if (updateEmits === 1) {
        updateEmits++
        const mantleNetwork = settingsController.networks.find(({ id }) => id === 'mantle')
        console.log(mantleNetwork)
        expect(mantleNetwork).not.toBe(undefined)
        expect(mantleNetwork).not.toBe(null)
        expect(mantleNetwork?.chainId).toBe(5000n)
        expect(mantleNetwork?.name).toBe('Mantle')
        expect(mantleNetwork?.id).toBe('mantle')
        expect(mantleNetwork?.nativeAssetSymbol).toBe('MNT')

        // mantle has the entry point uploaded
        expect(mantleNetwork?.erc4337?.enabled).toBe(true)
        expect(mantleNetwork?.erc4337?.hasPaymaster).toBe(false)

        // has smart accounts
        expect(mantleNetwork?.isSAEnabled).toBe(true)

        // contracts are not deployed
        expect(mantleNetwork?.areContractsDeployed).toBe(false)

        // is not 1559
        expect(mantleNetwork?.feeOptions.is1559).toBe(true)

        // mantle is optimistic
        expect(mantleNetwork?.isOptimistic).toBe(true)

        // coingecko
        expect(mantleNetwork?.platformId).toBe('mantle')
        expect(mantleNetwork?.nativeAssetId).toBe('mantle')

        expect(mantleNetwork?.features.length).toBe(3)

        // simulation is somewhat supported
        expect(mantleNetwork?.rpcNoStateOverride).toBe(false)
        expect(mantleNetwork?.hasDebugTraceCall).toBe(false)

        // contracts are not deployed
        const saSupport = mantleNetwork?.features.find((feat) => feat.id === 'saSupport')
        expect(saSupport).not.toBe(null)
        expect(saSupport).not.toBe(undefined)
        expect(saSupport!.level).toBe('warning')

        // no fee tokens
        const noFeeTokens = mantleNetwork?.features.find((feat) => feat.id === 'feeTokens')
        expect(noFeeTokens).not.toBe(null)
        expect(noFeeTokens).not.toBe(undefined)
        expect(noFeeTokens!.level).toBe('warning')

        // somewhat simulation
        const simulation = mantleNetwork?.features.find((feat) => feat.id === 'simulation')
        expect(simulation).not.toBe(null)
        expect(simulation).not.toBe(undefined)
        expect(simulation!.level).toBe('warning')

        checks++
        if (checks === 3) {
          done()
        }
      }
    })

    let errorEmits = 0
    settingsController.onError(() => {
      if (errorEmits === 0) {
        const errors = settingsController.emittedErrors
        expect(errors.length).toEqual(1)
        expect(errors[0].message).toEqual(
          'Failed to detect network, perhaps an RPC issue. Please change the RPC and try again'
        )
      }
      if (errorEmits === 1) {
        const errors = settingsController.emittedErrors
        expect(errors.length).toEqual(2)
        expect(errors[1].message).toEqual(
          'Failed to detect network, perhaps an RPC issue. Please change the RPC and try again'
        )
      }
      errorEmits++
      checks++
      if (checks === 3) {
        done()
      }
    })

    settingsController
      .addCustomNetwork({
        name: 'Mantle',
        chainId: 5000n,
        explorerUrl: 'https://explorer.mantle.xyz/',
        nativeAssetSymbol: 'MNT',
        rpcUrl: 'https://rpc.mantle.xyz'
      })
      .then(() => {
        // try to add the network again, it should fail the second time
        // because of unique id
        settingsController
          .addCustomNetwork({
            name: 'Mantle',
            chainId: 5000n,
            explorerUrl: 'https://explorer.mantle.xyz/',
            nativeAssetSymbol: 'MNT',
            rpcUrl: 'https://rpc.mantle.xyz'
          })
          .then(() => {
            // try to add the network again, it should fail because of
            // unique network id
            settingsController.addCustomNetwork({
              name: 'Mantle',
              chainId: 5001n,
              explorerUrl: 'https://explorer.mantle.xyz/',
              nativeAssetSymbol: 'MNT',
              rpcUrl: 'https://rpc.mantle.xyz'
            })
          })
      })
  })

  test('should add the fantom network as a custom network', (done) => {
    let updateEmits = 0
    settingsController.onUpdate(() => {
      if (updateEmits === 0) {
        updateEmits++
        return
      }

      if (updateEmits === 1) {
        updateEmits++
        const fantomNetwork = settingsController.networks.find(({ id }) => id === 'fantom')
        expect(fantomNetwork).not.toBe(undefined)
        expect(fantomNetwork).not.toBe(null)
        expect(fantomNetwork?.chainId).toBe(250n)
        expect(fantomNetwork?.name).toBe('Fantom')
        expect(fantomNetwork?.id).toBe('fantom')
        expect(fantomNetwork?.nativeAssetSymbol).toBe('FTM')

        // fantom does not have the entry point
        expect(fantomNetwork?.erc4337?.enabled).toBe(false)
        expect(fantomNetwork?.erc4337?.hasPaymaster).toBe(false)

        // ...nor does it have the singleton
        expect(fantomNetwork?.isSAEnabled).toBe(true)

        // so contracts are not deployed
        expect(fantomNetwork?.areContractsDeployed).toBe(false)

        // it is 1559
        expect(fantomNetwork?.feeOptions.is1559).toBe(true)

        // it is not optimistic
        expect(fantomNetwork?.isOptimistic).toBe(false)

        // simulation is somewhat supported
        expect(fantomNetwork?.rpcNoStateOverride).toBe(false)
        expect(fantomNetwork?.hasDebugTraceCall).toBe(false)

        // coingecko
        expect(fantomNetwork?.platformId).toBe('fantom')
        expect(fantomNetwork?.nativeAssetId).toBe('fantom')

        // contracts are not deployed
        const saSupport = fantomNetwork?.features.find((feat) => feat.id === 'saSupport')
        expect(saSupport).not.toBe(null)
        expect(saSupport).not.toBe(undefined)
        expect(saSupport!.level).toBe('warning')

        // no fee tokens
        const noFeeTokens = fantomNetwork?.features.find((feat) => feat.id === 'feeTokens')
        expect(noFeeTokens).not.toBe(null)
        expect(noFeeTokens).not.toBe(undefined)
        expect(noFeeTokens!.level).toBe('warning')

        // somewhat simulation
        const simulation = fantomNetwork?.features.find((feat) => feat.id === 'simulation')
        expect(simulation).not.toBe(null)
        expect(simulation).not.toBe(undefined)
        expect(simulation!.level).toBe('warning')
      }

      done()
    })

    settingsController.addCustomNetwork({
      name: 'Fantom',
      chainId: 250n,
      explorerUrl: 'https://ftmscan.com/',
      nativeAssetSymbol: 'FTM',
      rpcUrl: 'https://fantom-pokt.nodies.app'
    })
  })
})
