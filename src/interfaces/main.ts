import { ControllerInterface } from './controller'

export type IMainController = ControllerInterface<
  InstanceType<typeof import('../controllers/main/main').MainController>
>

export const STATUS_WRAPPED_METHODS = {
  removeAccount: 'INITIAL',
  updateAccounts: 'INITIAL',
  handleAccountPickerInitLedger: 'INITIAL',
  handleAccountPickerInitTrezor: 'INITIAL',
  handleAccountPickerInitOneKey: 'INITIAL',
  handleAccountPickerInitLattice: 'INITIAL',
  handleAccountPickerInitQr: 'INITIAL',
  handleAccountPickerInitNfc: 'INITIAL',
  importSmartAccountFromDefaultSeed: 'INITIAL',
  selectAccount: 'INITIAL',
  privacyPoolsRagequit: 'INITIAL',
  accountPickerSetInitParamsFromNewSeed: 'INITIAL',
  accountPickerSetInitParamsFromPrivateKeys: 'INITIAL',
  fetchSafeTxns: 'INITIAL',
  refreshSafeTxns: 'INITIAL'
} as const
