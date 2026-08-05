import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { FeeSpeed } from '../../interfaces/signAccountOp'
import { IStorageController, StorageProps } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

export type SignAccountOpFeeTokenPreference = StorageProps['signAccountOpFeeTokenPreference']

export const FEE_TOKEN_PREFERENCE_STORAGE_KEY = 'signAccountOpFeeTokenPreference'
export const FEE_SPEED_PREFERENCE_STORAGE_KEY = 'signAccountOpFeeSpeedPreference'

export class SignAccountOpPreferenceController extends EventEmitter {
  #storage: IStorageController

  #updateQueue: Promise<void> = Promise.resolve()

  feeTokenPreference: SignAccountOpFeeTokenPreference = {}

  feeSpeedPreference: FeeSpeed = FeeSpeed.Fast

  initialLoadPromise?: Promise<void>

  constructor({
    eventEmitterRegistry,
    storage
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    storage: IStorageController
  }) {
    super(eventEmitterRegistry)

    this.#storage = storage
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    try {
      this.feeTokenPreference = await this.#storage.get(FEE_TOKEN_PREFERENCE_STORAGE_KEY, {})
      const feeSpeedPreference = await this.#storage.get(
        FEE_SPEED_PREFERENCE_STORAGE_KEY,
        FeeSpeed.Fast
      )
      this.feeSpeedPreference = Object.values(FeeSpeed).includes(feeSpeedPreference)
        ? feeSpeedPreference
        : FeeSpeed.Fast
      this.emitUpdate()
    } catch (error) {
      this.emitError({
        message: 'Error loading SignAccountOp fee token preference',
        error: error instanceof Error ? error : new Error(String(error)),
        level: 'silent'
      })
    }
  }

  async setFeeTokenPreference(feeTokenPreference: SignAccountOpFeeTokenPreference) {
    const update = this.#updateQueue.then(async () => {
      try {
        await this.#storage.set(FEE_TOKEN_PREFERENCE_STORAGE_KEY, feeTokenPreference)
        this.feeTokenPreference = feeTokenPreference
        this.emitUpdate()
      } catch (error) {
        this.emitError({
          message: 'Error saving SignAccountOp fee token preference',
          error: error instanceof Error ? error : new Error(String(error)),
          level: 'silent'
        })
        throw error
      }
    })

    this.#updateQueue = update.catch(() => {})
    await update
  }

  async setFeeSpeedPreference(feeSpeedPreference: FeeSpeed) {
    this.feeSpeedPreference = feeSpeedPreference
    this.emitUpdate()

    const update = this.#updateQueue.then(async () => {
      try {
        await this.#storage.set(FEE_SPEED_PREFERENCE_STORAGE_KEY, feeSpeedPreference)
      } catch (error) {
        this.emitError({
          message: 'Error saving SignAccountOp fee speed preference',
          error: error instanceof Error ? error : new Error(String(error)),
          level: 'silent'
        })
      }
    })

    this.#updateQueue = update
    await update
  }
}
