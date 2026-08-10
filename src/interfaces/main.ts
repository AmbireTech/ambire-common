import { ControllerInterface } from './controller'

export type IMainController = ControllerInterface<
  InstanceType<typeof import('../controllers/main/main').MainController>
>

export const STATUS_WRAPPED_METHODS = {
  removeAccount: 'INITIAL',
  updateAccounts: 'INITIAL',
  handleAccountPickerInitLedger: 'INITIAL',
  handleAccountPickerInitTrezor: 'INITIAL',
  handleAccountPickerInitLattice: 'INITIAL',
  handleAccountPickerInitQr: 'INITIAL',
  handleAccountPickerInitNfc: 'INITIAL',
  importSmartAccountFromDefaultSeed: 'INITIAL',
  selectAccount: 'INITIAL',
  accountPickerSetInitParamsFromNewSeed: 'INITIAL',
  refreshSafeTxns: 'INITIAL'
} as const
