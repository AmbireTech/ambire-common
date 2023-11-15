import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { SettingsController } from './settings'

describe('Settings Controller', () => {
  let settingsController: SettingsController
  beforeEach(() => {
    settingsController = new SettingsController(produceMemoryStore(), networks)
  })

  test('should throw if adding an account preference is requested with invalid address', (done) => {
    let emitCounter = 0
    settingsController.onError(() => {
      emitCounter++

      if (emitCounter === 1) {
        const errors = settingsController.getErrors()
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

  test('should remove preferences if valid address is provided', (done) => {
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
        const errors = settingsController.getErrors()
        expect(errors.length).toEqual(1)
        done()
      }
    })

    settingsController.addKeyPreferences([
      { addr: '0x-invalid-address', type: 'internal', label: 'test' }
    ])
  })

  test('should add key preferences', (done) => {
    const validAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    const preference = { addr: validAddress, type: 'internal', label: 'na Kalo malkiq... kluch' }

    let emitCounter = 0
    settingsController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        // Cast to AccountPreferences, because TS doesn't know that we just added a preference
        expect(settingsController.accountPreferences[validAddress]).toEqual(preference)
        done()
      }
    })

    settingsController.addKeyPreferences([preference])
  })
})
