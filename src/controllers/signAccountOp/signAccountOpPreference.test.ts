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
    // @ts-expect-error intentionally exercising legacy/corrupt stored shapes
    await storage.set(FEE_SPEED_PREFERENCE_STORAGE_KEY, storedFeeSpeed)
  }

  const preference = new SignAccountOpPreferenceController({ storage })
  await preference.initialLoadPromise

  return { preference, storage }
}

describe('SignAccountOpPreferenceController fee speed preference', () => {
  test('defaults to no saved speeds when nothing is stored', async () => {
    const { preference } = await initializePreference()

    expect(preference.feeSpeedPreference).toEqual({})
  })

  test('loads saved per-network fee speeds', async () => {
    const { preference } = await initializePreference({
      '1': FeeSpeed.Medium,
      '10': FeeSpeed.Ape
    })

    expect(preference.feeSpeedPreference).toEqual({
      '1': FeeSpeed.Medium,
      '10': FeeSpeed.Ape
    })
  })

  test('drops only the invalid entries of a stored map', async () => {
    const { preference } = await initializePreference({
      '1': FeeSpeed.Slow,
      '10': 'invalid-speed'
    })

    expect(preference.feeSpeedPreference).toEqual({ '1': FeeSpeed.Slow })
  })

  test('discards a legacy global fee speed stored as a plain string', async () => {
    const { preference } = await initializePreference(FeeSpeed.Medium)

    expect(preference.feeSpeedPreference).toEqual({})
  })

  test('discards a stored array', async () => {
    const { preference } = await initializePreference([FeeSpeed.Medium])

    expect(preference.feeSpeedPreference).toEqual({})
  })

  test('updates immediately and persists the selected fee speeds', async () => {
    const { preference, storage } = await initializePreference()

    await preference.setFeeSpeedPreference({ '1': FeeSpeed.Slow })

    expect(preference.feeSpeedPreference).toEqual({ '1': FeeSpeed.Slow })
    await expect(storage.get(FEE_SPEED_PREFERENCE_STORAGE_KEY)).resolves.toEqual({
      '1': FeeSpeed.Slow
    })
  })

  test('saving a speed for one network leaves the others intact', async () => {
    const { preference, storage } = await initializePreference({ '1': FeeSpeed.Medium })

    await preference.setFeeSpeedPreference({
      ...preference.feeSpeedPreference,
      '10': FeeSpeed.Ape
    })

    await expect(storage.get(FEE_SPEED_PREFERENCE_STORAGE_KEY)).resolves.toEqual({
      '1': FeeSpeed.Medium,
      '10': FeeSpeed.Ape
    })
  })

  test('keeps the in-memory preference and emits an error when storage fails', async () => {
    const { preference, storage } = await initializePreference()
    const storageError = new Error('Storage unavailable')
    jest.spyOn(storage, 'set').mockRejectedValueOnce(storageError)
    const onError = jest.fn()
    preference.onError(onError)

    await expect(preference.setFeeSpeedPreference({ '1': FeeSpeed.Ape })).resolves.toBeUndefined()

    expect(preference.feeSpeedPreference).toEqual({ '1': FeeSpeed.Ape })
    expect(onError).toHaveBeenCalledWith({
      message: 'Error saving SignAccountOp fee speed preference',
      error: storageError,
      level: 'silent'
    })
  })
})
