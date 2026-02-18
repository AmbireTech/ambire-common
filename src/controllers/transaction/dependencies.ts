import { IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IInviteController } from '../../interfaces/invite'
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import { LiFiAPI } from '../../services/lifi/api'
import { SocketAPI } from '../../services/socket/api'

export type TransactionDependencies = {
  eventEmitterRegistry?: IEventEmitterRegistryController
  accounts: IAccountsController
  keystore: IKeystoreController
  portfolio: IPortfolioController
  externalSignerControllers: ExternalSignerControllers
  providers: IProvidersController
  selectedAccount: ISelectedAccountController
  networks: INetworksController
  activity: IActivityController
  serviceProviderAPI: SocketAPI | LiFiAPI
  storage: IStorageController
  invite: IInviteController
  portfolioUpdate?: Function
}

export type ControllersTransactionDependencies = TransactionDependencies & {
  interopSDK: any
}
