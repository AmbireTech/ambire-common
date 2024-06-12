/* eslint-disable @typescript-eslint/no-floating-promises */

import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
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
})
