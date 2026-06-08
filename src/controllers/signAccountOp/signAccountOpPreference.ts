import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IStorageController, StorageProps } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

export type SignAccountOpFeeTokenPreference = StorageProps['signAccountOpFeeTokenPreference']

export const FEE_TOKEN_PREFERENCE_STORAGE_KEY = 'signAccountOpFeeTokenPreference'

export class SignAccountOpPreferenceController extends EventEmitter {
  #storage: IStorageController

  feeTokenPreference: SignAccountOpFeeTokenPreference = {}

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
    this.feeTokenPreference = feeTokenPreference
    this.emitUpdate()

    try {
      await this.#storage.set(FEE_TOKEN_PREFERENCE_STORAGE_KEY, this.feeTokenPreference)
    } catch (error) {
      this.emitError({
        message: 'Error saving SignAccountOp fee token preference',
        error: error instanceof Error ? error : new Error(String(error)),
        level: 'silent'
      })
    }
  }
}
