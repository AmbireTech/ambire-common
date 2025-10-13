import { ControllerInterface } from './controller'

export type IMainController = ControllerInterface<
  InstanceType<typeof import('../controllers/main/main').MainController>
>

export const STATUS_WRAPPED_METHODS = {
  removeAccount: 'INITIAL',
  handleAccountPickerInitLedger: 'INITIAL',
  handleAccountPickerInitTrezor: 'INITIAL',
  handleAccountPickerInitLattice: 'INITIAL',
  importSmartAccountFromDefaultSeed: 'INITIAL',
  selectAccount: 'INITIAL'
} as const
