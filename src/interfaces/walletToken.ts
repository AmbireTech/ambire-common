import { ControllerInterface } from './controller'

export type IWalletTokenController = ControllerInterface<
  InstanceType<typeof import('../controllers/walletToken/walletToken').WalletTokenController>
>
