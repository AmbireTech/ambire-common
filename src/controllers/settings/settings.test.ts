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
})
