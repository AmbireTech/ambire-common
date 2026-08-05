import { produceMemoryStore } from '../../../test/helpers'
import { FeeSpeed } from '../../interfaces/signAccountOp'
import { StorageController } from '../storage/storage'
import {
  FEE_SPEED_PREFERENCE_STORAGE_KEY,
  SignAccountOpPreferenceController
} from './signAccountOpPreference'

const initializePreference = async (storedFeeSpeed?: unknown) => {
  const storage = new StorageController(produceMemoryStore())
  if (storedFeeSpeed !== undefined) {
    await storage.set(FEE_SPEED_PREFERENCE_STORAGE_KEY, storedFeeSpeed)
  }

  const preference = new SignAccountOpPreferenceController({ storage })
  await preference.initialLoadPromise

  return { preference, storage }
}

describe('SignAccountOpPreferenceController fee speed preference', () => {
  test('defaults to fast when no preference is stored', async () => {
    const { preference } = await initializePreference()

    expect(preference.feeSpeedPreference).toBe(FeeSpeed.Fast)
  })

  test('loads a saved fee speed preference', async () => {
    const { preference } = await initializePreference(FeeSpeed.Medium)

    expect(preference.feeSpeedPreference).toBe(FeeSpeed.Medium)
  })

  test('ignores an invalid stored fee speed', async () => {
    const { preference } = await initializePreference('invalid-speed')

    expect(preference.feeSpeedPreference).toBe(FeeSpeed.Fast)
  })

  test('updates immediately and persists the selected fee speed', async () => {
    const { preference, storage } = await initializePreference()

    await preference.setFeeSpeedPreference(FeeSpeed.Slow)

    expect(preference.feeSpeedPreference).toBe(FeeSpeed.Slow)
    await expect(storage.get(FEE_SPEED_PREFERENCE_STORAGE_KEY)).resolves.toBe(FeeSpeed.Slow)
  })

  test('keeps the in-memory preference and emits an error when storage fails', async () => {
    const { preference, storage } = await initializePreference()
    const storageError = new Error('Storage unavailable')
    jest.spyOn(storage, 'set').mockRejectedValueOnce(storageError)
    const onError = jest.fn()
    preference.onError(onError)

    await expect(preference.setFeeSpeedPreference(FeeSpeed.Ape)).resolves.toBeUndefined()

    expect(preference.feeSpeedPreference).toBe(FeeSpeed.Ape)
    expect(onError).toHaveBeenCalledWith({
      message: 'Error saving SignAccountOp fee speed preference',
      error: storageError,
      level: 'silent'
    })
  })
})
