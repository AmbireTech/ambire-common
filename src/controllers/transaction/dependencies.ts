import { AccountsController } from '../accounts/accounts'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import { ExternalSignerControllers } from '../../interfaces/keystore'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { NetworksController } from '../networks/networks'
import { ActivityController } from '../activity/activity'
import { StorageController } from '../storage/storage'
import { ActionsController } from '../actions/actions'
import { InviteController } from '../invite/invite'
import { UserRequest } from '../../interfaces/userRequest'
import { LiFiAPI } from '../../services/lifi/api'
import { SocketAPI } from '../../services/socket/api'

export type TransactionDependencies = {
  accounts: AccountsController
  keystore: KeystoreController
  portfolio: PortfolioController
  externalSignerControllers: ExternalSignerControllers
  providers: ProvidersController
  selectedAccount: SelectedAccountController
  networks: NetworksController
  activity: ActivityController
  serviceProviderAPI: SocketAPI | LiFiAPI
  storage: StorageController
  actions: ActionsController
  invite: InviteController
  userRequests: UserRequest[]
  portfolioUpdate?: Function
}
