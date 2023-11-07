import { AccountPreferences } from 'interfaces/settings'

import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { SettingsController } from './settings'

describe('Settings Controller', () => {
  let settingsController: SettingsController
  beforeEach(() => {
    settingsController = new SettingsController({
      storage: produceMemoryStore()
    })
  })

  test('should throw if adding a preference is requested with invalid address', (done) => {
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
      '0x-invalid-address': { label: 'test', avatarId: 'whatever' }
    })
  })

  test('should add preferences if valid address is provided', (done) => {
    const validAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    const preferences = { label: 'test', avatarId: 'avatar' }

    let emitCounter = 0
    settingsController.onUpdate(() => {
      emitCounter++

      if (emitCounter === 1) {
        const { accountPreferences } = settingsController.currentSettings
        // Cast to AccountPreferences, because TS doesn't know that we just added a preference
        expect((accountPreferences as AccountPreferences)[validAddress]).toEqual(preferences)
        done()
      }
    })

    settingsController.addAccountPreferences({ [validAddress]: preferences })
  })
})
