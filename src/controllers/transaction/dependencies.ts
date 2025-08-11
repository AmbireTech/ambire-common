import { IInviteController } from 'interfaces/invite'

import { IAccountsController } from '../../interfaces/account'
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { LiFiAPI } from '../../services/lifi/api'
import { SocketAPI } from '../../services/socket/api'
import { ActivityController } from '../activity/activity'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'

export type TransactionDependencies = {
  accounts: IAccountsController
  keystore: IKeystoreController
  portfolio: IPortfolioController
  externalSignerControllers: ExternalSignerControllers
  providers: IProvidersController
  selectedAccount: SelectedAccountController
  networks: INetworksController
  activity: ActivityController
  serviceProviderAPI: SocketAPI | LiFiAPI
  storage: IStorageController
  invite: IInviteController
  portfolioUpdate?: Function
}

export type ControllersTransactionDependencies = TransactionDependencies & {
  interopSDK: any
}
