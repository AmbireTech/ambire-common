import { ControllerInterface } from './controller'

export type IMainController = ControllerInterface<
  InstanceType<typeof import('../controllers/main/main').MainController>
>

export type IExtensionMainController = ControllerInterface<
  InstanceType<typeof import('../controllers/main/mainEnvs').ExtensionMainController>
>

export type IMobileMainController = ControllerInterface<
  InstanceType<typeof import('../controllers/main/mainEnvs').MobileMainController>
>

export type IRewardsMainController = ControllerInterface<
  InstanceType<typeof import('../controllers/main/mainEnvs').RewardsMainController>
>

export type IExplorerMainController = ControllerInterface<
  InstanceType<typeof import('../controllers/main/mainEnvs').ExplorerMainController>
>

export const STATUS_WRAPPED_METHODS = {
  removeAccount: 'INITIAL',
  handleAccountPickerInitLedger: 'INITIAL',
  handleAccountPickerInitTrezor: 'INITIAL',
  handleAccountPickerInitLattice: 'INITIAL',
  importSmartAccountFromDefaultSeed: 'INITIAL',
  selectAccount: 'INITIAL'
} as const
