import { ControllerInterface } from './controller'
import { Statuses } from './eventEmitter'

export type IMainController = ControllerInterface<
  InstanceType<typeof import('../controllers/main/main').MainController>
>

export const STATUS_WRAPPED_METHODS = {
  removeAccount: 'INITIAL',
  handleAccountPickerInitLedger: 'INITIAL',
  handleAccountPickerInitTrezor: 'INITIAL',
  handleAccountPickerInitLattice: 'INITIAL',
  importSmartAccountFromDefaultSeed: 'INITIAL',
  selectAccount: 'INITIAL',
  signAndBroadcastAccountOp: 'INITIAL'
} as const

type CustomStatuses = {
  signAndBroadcastAccountOp: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'ERROR'
}

export type StatusesWithCustom = Statuses<keyof typeof STATUS_WRAPPED_METHODS> & CustomStatuses
