import { ethErrors } from 'eth-rpc-errors'
/* eslint-disable @typescript-eslint/brace-style */
import {
  getAddress,
  getBigInt,
  Interface,
  isAddress,
  toQuantity,
  TransactionResponse,
  ZeroAddress
} from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { AMBIRE_ACCOUNT_FACTORY, SINGLETON } from '../../consts/deploy'
import { Account, AccountId, AccountOnchainState, AccountStates } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { DappProviderRequest } from '../../interfaces/dapp'
import {
  ExternalSignerControllers,
  Key,
  KeystoreSignerType,
  TxnRequest
} from '../../interfaces/keystore'
import { AddNetworkRequestParams, Network, NetworkId } from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import { Call, DappUserRequest, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import { getDefaultSelectedAccount, isSmartAccount } from '../../libs/account/account'
import { AccountOp, AccountOpStatus, getSignableCalls } from '../../libs/accountOp/accountOp'
import { Call as AccountOpCall } from '../../libs/accountOp/types'
import { getAccountState } from '../../libs/accountState/accountState'
import {
  dappRequestMethodToActionKind,
  getAccountOpActionsByNetwork,
  getAccountOpFromAction,
  getAccountOpsByNetwork
} from '../../libs/actions/actions'
import { getAccountOpBanners } from '../../libs/banners/banners'
import { estimate } from '../../libs/estimate/estimate'
import { EstimateResult } from '../../libs/estimate/interfaces'
import { GasRecommendation, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { humanizeAccountOp } from '../../libs/humanizer'
import { makeBasicAccountOpAction, makeSmartAccountOpAction } from '../../libs/main/main'
import { GetOptions, TokenResult } from '../../libs/portfolio/interfaces'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { parse } from '../../libs/richJson/richJson'
import {
  adjustEntryPointAuthorization,
  getEntryPointAuthorization
} from '../../libs/signMessage/signMessage'
import { buildTransferUserRequest } from '../../libs/transfer/userRequest'
import {
  ENTRY_POINT_AUTHORIZATION_REQUEST_ID,
  isErc4337Broadcast,
  shouldAskForEntryPointAuthorization
} from '../../libs/userOperation/userOperation'
import bundler from '../../services/bundlers'
import { Bundler } from '../../services/bundlers/bundler'
import wait from '../../utils/wait'
import { AccountAdderController } from '../accountAdder/accountAdder'
import { AccountOpAction, ActionsController, SignMessageAction } from '../actions/actions'
import { ActivityController, SignedMessage, SubmittedAccountOp } from '../activity/activity'
import { AddressBookController } from '../addressBook/addressBook'
import { DappsController } from '../dapps/dapps'
import { DomainsController } from '../domains/domains'
import { EmailVaultController } from '../emailVault/emailVault'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { SettingsController } from '../settings/settings'
/* eslint-disable no-underscore-dangle */
import { SignAccountOpController, SigningStatus } from '../signAccountOp/signAccountOp'
import { SignMessageController } from '../signMessage/signMessage'

const STATUS_WRAPPED_METHODS = {
  onAccountAdderSuccess: 'INITIAL',
  selectAccount: 'INITIAL'
} as const

export class MainController extends EventEmitter {
  #storage: Storage

  #fetch: Function

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  #callRelayer: Function

  accountStates: AccountStates = {}

  isReady: boolean = false

  invite: InviteController

  keystore: KeystoreController

  /**
   * Hardware wallets (usually) need an additional (external signer) controller,
   * that is app-specific (web, mobile) and is used to interact with the device.
   * (example: LedgerController, TrezorController, LatticeController)
   */
  #externalSignerControllers: ExternalSignerControllers = {}

  // Subcontrollers
  networks: NetworksController

  providers: ProvidersController

  accountAdder: AccountAdderController

  portfolio: PortfolioController

  dapps: DappsController

  actions: ActionsController

  // Public sub-structures
  // @TODO emailVaults
  emailVault: EmailVaultController

  signMessage!: SignMessageController

  signAccountOp: SignAccountOpController | null = null

  static signAccountOpListener: ReturnType<EventEmitter['onUpdate']> = () => {}

  signAccOpInitError: string | null = null

  activity!: ActivityController

  settings: SettingsController

  addressBook: AddressBookController

  domains: DomainsController

  // @TODO read networks from settings
  accounts: (Account & { newlyCreated?: boolean })[] = []

  selectedAccount: AccountId | null = null

  userRequests: UserRequest[] = []

  // network => GasRecommendation[]
  gasPrices: { [key: string]: GasRecommendation[] } = {}

  accountOpsToBeConfirmed: { [key: string]: { [key: string]: AccountOp } } = {}

  lastUpdate: Date = new Date()

  broadcastStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  #windowManager: WindowManager

  onBroadcastSuccess?: (type: 'message' | 'typed-data' | 'account-op') => void

  constructor({
    storage,
    fetch,
    relayerUrl,
    keystoreSigners,
    externalSignerControllers,
    windowManager,
    onBroadcastSuccess
  }: {
    storage: Storage
    fetch: Function
    relayerUrl: string
    keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>
    externalSignerControllers: ExternalSignerControllers
    windowManager: WindowManager
    onBroadcastSuccess?: (type: 'message' | 'typed-data' | 'account-op') => void
  }) {
    super()
    this.#storage = storage
    this.#fetch = fetch
    this.#windowManager = windowManager

    this.invite = new InviteController({ relayerUrl, fetch, storage: this.#storage })
    this.keystore = new KeystoreController(this.#storage, keystoreSigners)
    this.#externalSignerControllers = externalSignerControllers
    this.networks = new NetworksController(
      this.#storage,
      async (network: Network) => {
        this.providers.setProvider(network)
        await this.updateAccountStates('latest', [network.id])
        await this.updateSelectedAccount(this.selectedAccount, true)
      },
      (networkId: NetworkId) => {
        this.providers.removeProvider(networkId)
      }
    )
    this.providers = new ProvidersController(this.networks)
    this.settings = new SettingsController(this.#storage)
    this.portfolio = new PortfolioController(
      this.#storage,
      this.providers,
      this.networks,
      relayerUrl
    )
    this.#initialLoadPromise = this.#load()
    this.emailVault = new EmailVaultController(
      this.#storage,
      this.#fetch,
      relayerUrl,
      this.keystore
    )
    this.accountAdder = new AccountAdderController({
      alreadyImportedAccounts: this.accounts,
      keystore: this.keystore,
      relayerUrl,
      fetch: this.#fetch
    })
    this.addressBook = new AddressBookController(this.#storage, this.accounts, this.settings)
    this.signMessage = new SignMessageController(
      this.keystore,
      this.providers,
      this.networks,
      this.#externalSignerControllers,
      this.#storage,
      this.#fetch
    )
    this.dapps = new DappsController(this.#storage)
    this.actions = new ActionsController({
      selectedAccount: this.selectedAccount,
      windowManager,
      onActionWindowClose: () => {
        this.userRequests = this.userRequests.filter((r) => r.action.kind !== 'benzin')
        this.emitUpdate()
      }
    })
    this.domains = new DomainsController(this.providers.providers, this.#fetch)
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch: this.#fetch })
    this.onBroadcastSuccess = onBroadcastSuccess
  }

  async #load(): Promise<void> {
    this.isReady = false
    // #load is called in the constructor which is synchronous
    // we await (1 ms/next tick) for the constructor to extend the EventEmitter class
    // and then we call it's methods
    await wait(1)
    this.emitUpdate()
    await this.networks.initialLoadPromise
    await this.providers.initialLoadPromise
    const [accounts, selectedAccount] = await Promise.all([
      this.#storage.get('accounts', []),
      this.#storage.get('selectedAccount', null)
    ])
    // Do not re-assign `this.accounts`, use `push` instead in order NOT to break
    // the the reference link between `this.accounts` in the nested controllers.
    this.accounts.push(...accounts)
    this.selectedAccount = selectedAccount

    // @TODO reload those
    // @TODO error handling here
    this.accountStates = await this.#getAccountsInfo(this.accounts)
    this.activity = new ActivityController(
      this.#storage,
      this.accountStates,
      this.providers,
      this.networks,
      async (network: Network) => {
        await this.setContractsDeployedToTrueIfDeployed(network)
      }
    )

    if (this.selectedAccount) {
      this.activity.init({ selectedAccount: this.selectedAccount })
      this.addressBook.update({ selectedAccount })
      this.actions.update({ selectedAccount })
    }

    this.updateSelectedAccount(this.selectedAccount)

    /**
     * Listener that gets triggered as a finalization step of adding new
     * accounts via the AccountAdder controller flow.
     *
     * VIEW-ONLY ACCOUNTS: In case of changes in this method, make sure these
     * changes are reflected for view-only accounts as well. Because the
     * view-only accounts import flow bypasses the AccountAdder, this method
     * won't click for them. Their on add success flow continues in the
     * MAIN_CONTROLLER_ADD_VIEW_ONLY_ACCOUNTS action case.
     */
    const onAccountAdderSuccess = () => {
      if (this.accountAdder.addAccountsStatus !== 'SUCCESS') return

      return this.withStatus(
        'onAccountAdderSuccess',
        async () => {
          // Add accounts first, because some of the next steps have validation
          // if accounts exists.
          await this.addAccounts(this.accountAdder.readyToAddAccounts)

          // Then add keys, because some of the next steps could have validation
          // if keys exists. Should be separate (not combined in Promise.all,
          // since firing multiple keystore actions is not possible
          // (the #wrapKeystoreAction listens for the first one to finish and
          // skips the parallel one, if one is requested).
          await this.keystore.addKeys(this.accountAdder.readyToAddKeys.internal)
          await this.keystore.addKeysExternallyStored(this.accountAdder.readyToAddKeys.external)

          await Promise.all([
            this.settings.addKeyPreferences(this.accountAdder.readyToAddKeyPreferences),
            this.settings.addAccountPreferences(this.accountAdder.readyToAddAccountPreferences),
            (() => {
              const defaultSelectedAccount = getDefaultSelectedAccount(
                this.accountAdder.readyToAddAccounts
              )
              if (!defaultSelectedAccount) return Promise.resolve()

              return this.#selectAccount(defaultSelectedAccount.addr)
            })()
          ])
        },
        true
      )
    }
    this.accountAdder.onUpdate(onAccountAdderSuccess)

    this.isReady = true
    this.emitUpdate()
  }

  initSignAccOp(actionId: AccountOpAction['id']): null | void {
    const accountOp = getAccountOpFromAction(actionId, this.actions.actionsQueue)
    if (!accountOp) {
      this.signAccOpInitError =
        'We cannot initiate the signing process because no transaction has been found for the specified account and network.'
      return null
    }

    const account = this.accounts?.find((acc) => acc.addr === accountOp.accountAddr)
    const network = this.networks.networks.find((net) => net.id === accountOp.networkId)

    if (!account) {
      this.signAccOpInitError =
        'We cannot initiate the signing process as we are unable to locate the specified account.'
      return null
    }

    if (!network) {
      this.signAccOpInitError =
        'We cannot initiate the signing process as we are unable to locate the specified network.'
      return null
    }

    this.signAccOpInitError = null

    this.signAccountOp = new SignAccountOpController(
      this.keystore,
      this.portfolio,
      this.providers,
      this.#externalSignerControllers,
      account,
      this.accountStates,
      network,
      actionId,
      accountOp,
      this.#storage,
      this.#fetch,
      this.#callRelayer
    )

    const broadcastSignedAccountOpIfNeeded = async () => {
      // Signing is completed, therefore broadcast the transaction
      if (
        this.signAccountOp &&
        this.signAccountOp.accountOp.signature &&
        this.signAccountOp.status?.type === SigningStatus.Done
      ) {
        await this.broadcastSignedAccountOp(
          this.signAccountOp.accountOp,
          this.signAccountOp.estimation!,
          this.signAccountOp.fromActionId
        )
      }
    }
    MainController.signAccountOpListener = this.signAccountOp.onUpdate(
      broadcastSignedAccountOpIfNeeded
    )

    this.emitUpdate()

    this.updateSignAccountOpGasPrice()
    this.estimateSignAccountOp()
  }

  destroySignAccOp() {
    this.signAccountOp = null
    this.signAccOpInitError = null
    MainController.signAccountOpListener() // unsubscribes for further updates
    this.updateSelectedAccount(this.selectedAccount, true)

    this.emitUpdate()
  }

  async updateAccountsOpsStatuses() {
    await this.#initialLoadPromise

    const { shouldEmitUpdate, shouldUpdatePortfolio } =
      await this.activity.updateAccountsOpsStatuses()

    if (shouldEmitUpdate) {
      this.emitUpdate()

      if (shouldUpdatePortfolio) {
        this.updateSelectedAccount(this.selectedAccount, true)
      }
    }
  }

  async #updateGasPrice() {
    await this.#initialLoadPromise

    // We want to update the gas price only for the networks having account ops.
    // Together with that, we make sure `ethereum` is included, as we always want to know its gas price (once we have a gas indicator, we will need it).
    // Note<Bobby>: remove ethereum as the above currently is not true
    const gasPriceNetworks = [
      ...new Set(this.userRequests.map((r) => r.meta.networkId).filter(Boolean))
    ]

    await Promise.all(
      gasPriceNetworks.map(async (network) => {
        try {
          const prices = await getGasPriceRecommendations(
            this.providers.providers[network],
            this.networks.networks.find((net) => net.id === network)!
          )

          // 1. get the current account op if any and get its nonce
          // 2. check the activity controller for an accountOp with the same nonce
          // 3. if there is, increate the fees by 12.5% on each level to be able to do RBF
          if (!this.selectedAccount) {
            this.gasPrices[network] = prices
            return
          }

          const accountOpsByNetwork = getAccountOpsByNetwork(
            this.selectedAccount,
            this.actions.visibleActionsQueue
          )
          const accountOps = accountOpsByNetwork ? accountOpsByNetwork[network] : []
          if (!accountOps.length) {
            this.gasPrices[network] = prices
            return
          }

          const lastAccountOp = this.activity.lastAccountOps[network]
          // no RBF if erc-4337
          if (!lastAccountOp || lastAccountOp.gasFeePayment?.isERC4337) {
            this.gasPrices[network] = prices
            return
          }

          // take the nonce from the account state
          const currentNonce =
            this.accountStates[this.selectedAccount] &&
            this.accountStates[this.selectedAccount][network]
              ? this.accountStates[this.selectedAccount][network].nonce
              : null
          if (currentNonce && currentNonce != lastAccountOp.nonce) {
            this.gasPrices[network] = prices
            return
          }

          // modify the prices by 12.5% and do an RBF
          this.gasPrices[network] = prices.map((price) => {
            if ('gasPrice' in price) price.gasPrice = price.gasPrice + price.gasPrice / 8n
            if ('baseFeePerGas' in price)
              price.baseFeePerGas = price.baseFeePerGas + price.baseFeePerGas / 8n

            return price
          })
        } catch (e: any) {
          this.emitError({
            level: 'major',
            message: `Unable to get gas price for ${
              this.networks.networks.find((n) => n.id === network)?.name
            }`,
            error: new Error(`Failed to fetch gas price: ${e?.message}`)
          })
        }
      })
    )
  }

  async #getAccountsInfo(
    accounts: Account[],
    blockTag: string | number = 'latest',
    updateOnlyNetworksWithIds: NetworkId[] = []
  ): Promise<AccountStates> {
    // if any, update the account state only for the passed networks; else - all
    const updateOnlyPassedNetworks = updateOnlyNetworksWithIds.length
    const networksToUpdate = updateOnlyPassedNetworks
      ? this.networks.networks.filter((network) => updateOnlyNetworksWithIds.includes(network.id))
      : this.networks.networks

    const fetchedState = await Promise.all(
      networksToUpdate.map(async (network) =>
        getAccountState(this.providers.providers[network.id], network, accounts, blockTag).catch(
          () => []
        )
      )
    )

    const networkState: { [networkId: NetworkId]: AccountOnchainState[] } = {}
    networksToUpdate.forEach((network: Network, index) => {
      if (!fetchedState[index].length) return

      networkState[network.id] = fetchedState[index]
    })

    const states = accounts.reduce((accStates: AccountStates, acc: Account, accIndex: number) => {
      const networkStates = this.networks.networks.reduce(
        (netStates: AccountStates[keyof AccountStates], network) => {
          // if a flag for updateOnlyPassedNetworks is passed, we load
          // the ones not requested from the previous state
          if (updateOnlyPassedNetworks && !updateOnlyNetworksWithIds.includes(network.id)) {
            return {
              ...netStates,
              [network.id]: this.accountStates[acc.addr][network.id]
            }
          }

          if (!(network.id in networkState) || !(accIndex in networkState[network.id])) {
            this.providers.updateProviderIsWorking(network.id, false)
            return netStates
          }

          this.providers.updateProviderIsWorking(network.id, true)

          return {
            ...netStates,
            [network.id]: networkState[network.id][accIndex]
          }
        },
        {}
      )

      return {
        ...accStates,
        [acc.addr]: networkStates
      }
    }, {})

    return states
  }

  async updateAccountStates(blockTag: string | number = 'latest', networks: NetworkId[] = []) {
    const nextAccountStates = await this.#getAccountsInfo(this.accounts, blockTag, networks)
    // Use `Object.assign` to update `this.accountStates` on purpose! That's
    // in order NOT to break the the reference link between `this.accountStates`
    // in the MainController and in the ActivityController. Reassigning
    // `this.accountStates` to a new object would break the reference link which
    // is crucial for ensuring that updates to account states are synchronized
    // across both classes.
    Object.assign(this.accountStates, {}, nextAccountStates)
    this.lastUpdate = new Date()
    this.emitUpdate()
  }

  // All operations must be synchronous so the change is instantly reflected in the UI
  async selectAccount(toAccountAddr: string) {
    await this.withStatus('selectAccount', async () => this.#selectAccount(toAccountAddr), true)
  }

  async #selectAccount(toAccountAddr: string) {
    await this.#initialLoadPromise

    if (!this.accounts.find((acc) => acc.addr === toAccountAddr)) {
      // TODO: error handling, trying to switch to account that does not exist
      return
    }

    this.selectedAccount = toAccountAddr
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('selectedAccount', toAccountAddr)
    this.activity.init({ selectedAccount: toAccountAddr })
    this.addressBook.update({ selectedAccount: toAccountAddr })
    this.actions.update({ selectedAccount: toAccountAddr })
    this.dapps.broadcastDappSessionEvent('accountsChanged', toAccountAddr ? [toAccountAddr] : [])
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.updateSelectedAccount(toAccountAddr)

    this.emitUpdate()
  }

  /**
   * Adds and stores in the MainController the required data for the newly
   * added accounts by the AccountAdder controller.
   */
  async addAccounts(accounts: (Account & { newlyCreated?: boolean })[] = []) {
    if (!accounts.length) return
    const alreadyAddedAddressSet = new Set(this.accounts.map((account) => account.addr))
    const newAccountsNotAddedYet = accounts.filter((acc) => !alreadyAddedAddressSet.has(acc.addr))
    const newAccountsAlreadyAdded = accounts.filter((acc) => alreadyAddedAddressSet.has(acc.addr))

    const nextAccounts = [
      ...this.accounts.map((acc) => ({
        ...acc,
        // reset the `newlyCreated` state for all already added accounts
        newlyCreated: false,
        // Merge the existing and new associated keys for the account (if the
        // account was already imported). This ensures up-to-date keys,
        // considering changes post-import (associated keys of the smart
        // accounts can change) or incomplete initial data (during the initial
        // import, not all associated keys could have been fetched (for privacy).
        associatedKeys: Array.from(
          new Set([
            ...acc.associatedKeys,
            ...(newAccountsAlreadyAdded.find((x) => x.addr === acc.addr)?.associatedKeys || [])
          ])
        )
      })),
      ...newAccountsNotAddedYet
    ]
    await this.#storage.set('accounts', nextAccounts)
    // Clean the existing array ref and use `push` instead of re-assigning
    // `this.accounts` to a new array in order NOT to break the the reference
    // link between `this.accounts` in the nested controllers.
    this.accounts.length = 0
    this.accounts.push(...nextAccounts)

    await this.updateAccountStates()

    this.emitUpdate()
  }

  // call this function after a call to the singleton has been made
  // it will check if the factory has been deployed and update the network settings if it has been
  async setContractsDeployedToTrueIfDeployed(network: Network) {
    if (network.areContractsDeployed) return

    const provider = this.providers.providers[network.id]
    if (!provider) return

    const factoryCode = await provider.getCode(AMBIRE_ACCOUNT_FACTORY)
    if (factoryCode === '0x') return
    await this.networks.updateNetwork({ areContractsDeployed: true }, network.id)
  }

  async #ensureAccountInfo(accountAddr: AccountId, networkId: NetworkId) {
    await this.#initialLoadPromise
    // Initial sanity check: does this account even exist?
    if (!this.accounts.find((x) => x.addr === accountAddr)) {
      this.signAccOpInitError = `Account ${accountAddr} does not exist`
      return
    }
    // If this still didn't work, re-load
    // @TODO: should we re-start the whole load or only specific things?
    if (!this.accountStates[accountAddr]?.[networkId])
      await (this.#initialLoadPromise = this.#load())
    // If this still didn't work, throw error: this prob means that we're calling for a non-existant acc/network
    if (!this.accountStates[accountAddr]?.[networkId])
      this.signAccOpInitError = `Failed to retrieve account info for ${networkId}, because of one of the following reasons: 1) network doesn't exist, 2) RPC is down for this network`
  }

  #batchCallsFromUserRequests(accountAddr: AccountId, networkId: NetworkId): AccountOpCall[] {
    // Note: we use reduce instead of filter/map so that the compiler can deduce that we're checking .kind
    return (this.userRequests.filter((r) => r.action.kind === 'call') as SignUserRequest[]).reduce(
      (uCalls: AccountOpCall[], req) => {
        if (req.meta.networkId === networkId && req.meta.accountAddr === accountAddr) {
          const { to, value, data } = req.action as Call
          uCalls.push({ to, value, data, fromUserRequestId: req.id })
        }
        return uCalls
      },
      []
    )
  }

  async updateSelectedAccount(selectedAccount: string | null = null, forceUpdate: boolean = false) {
    if (!selectedAccount) return

    // pass the accountOps if any so we could reflect the pending state
    const accountOps =
      this.actions.currentAction?.type === 'accountOp' && this.signAccountOp
        ? {
            [this.actions.currentAction.accountOp.networkId]: [this.actions.currentAction.accountOp]
          }
        : getAccountOpsByNetwork(selectedAccount, this.actions.visibleActionsQueue)
    this.portfolio.updateSelectedAccount(this.accounts, selectedAccount, undefined, accountOps, {
      forceUpdate
    })
  }

  async buildUserRequestFromDAppRequest(
    request: DappProviderRequest,
    dappPromise: {
      resolve: (data: any) => void
      reject: (data: any) => void
    }
  ) {
    let userRequest = null
    const kind = dappRequestMethodToActionKind(request.method)
    const dapp = this.dapps.getDapp(request.origin)

    if (!this.selectedAccount) {
      throw ethErrors.rpc.internal()
    }

    if (kind === 'call') {
      const transaction = request.params[0]
      const accountAddr = getAddress(transaction.from)
      const network = this.networks.networks.find(
        (n) => Number(n.chainId) === Number(dapp?.chainId)
      )

      if (!network) {
        throw ethErrors.provider.chainDisconnected('Transaction failed - unknown network')
      }
      delete transaction.from
      userRequest = {
        id: new Date().getTime(),
        action: {
          kind,
          ...transaction,
          value: transaction.value ? getBigInt(transaction.value) : 0n
        },
        meta: { isSignAction: true, accountAddr, networkId: network.id },
        dappPromise
      } as SignUserRequest
    } else if (kind === 'message') {
      const msg = request.params
      if (!msg) {
        throw ethErrors.rpc.invalidRequest('No msg request to sign')
      }
      const msdAddress = getAddress(msg?.[1])
      // TODO: if address is in this.accounts in theory the user should be able to sign
      // e.g. if an acc from the wallet is used as a signer of another wallet
      if (getAddress(msdAddress) !== getAddress(this.selectedAccount)) {
        dappPromise.resolve('Invalid parameters: must use the current user address to sign')
        return
      }

      const network = this.networks.networks.find(
        (n) => Number(n.chainId) === Number(dapp?.chainId)
      )

      if (!network) {
        throw ethErrors.provider.chainDisconnected('Transaction failed - unknown network')
      }

      userRequest = {
        id: new Date().getTime(),
        action: {
          kind: 'message',
          message: msg[0]
        },
        session: request.session,
        meta: {
          isSignAction: true,
          accountAddr: msdAddress,
          networkId: network.id
        },
        dappPromise
      } as SignUserRequest
    } else if (kind === 'typedMessage') {
      const msg = request.params
      if (!msg) {
        throw ethErrors.rpc.invalidRequest('No msg request to sign')
      }
      const msdAddress = getAddress(msg?.[0])
      // TODO: if address is in this.accounts in theory the user should be able to sign
      // e.g. if an acc from the wallet is used as a signer of another wallet
      if (getAddress(msdAddress) !== getAddress(this.selectedAccount)) {
        dappPromise.resolve('Invalid parameters: must use the current user address to sign')
        return
      }

      const network = this.networks.networks.find(
        (n) => Number(n.chainId) === Number(dapp?.chainId)
      )

      if (!network) {
        throw ethErrors.provider.chainDisconnected('Transaction failed - unknown network')
      }

      let typedData = msg?.[1]

      try {
        typedData = parse(typedData)
      } catch (error) {
        throw ethErrors.rpc.invalidRequest('Invalid typedData provided')
      }

      if (
        !typedData?.types ||
        !typedData?.domain ||
        !typedData?.message ||
        !typedData?.primaryType
      ) {
        throw ethErrors.rpc.methodNotSupported(
          'Invalid typedData format - only typedData v4 is supported'
        )
      }

      userRequest = {
        id: new Date().getTime(),
        action: {
          kind: 'typedMessage',
          types: typedData.types,
          domain: typedData.domain,
          message: typedData.message,
          primaryType: typedData.primaryType
        },
        session: request.session,
        meta: {
          isSignAction: true,
          accountAddr: msdAddress,
          networkId: network.id
        },
        dappPromise
      } as SignUserRequest
    } else {
      userRequest = {
        id: new Date().getTime(),
        session: request.session,
        action: { kind, params: request.params },
        meta: { isSignAction: false },
        dappPromise
      } as DappUserRequest
    }

    if (userRequest) {
      await this.addUserRequest(userRequest)
      this.emitUpdate()
    }
  }

  async buildTransferUserRequest(
    amount: string,
    recipientAddress: string,
    selectedToken: TokenResult
  ) {
    if (!this.selectedAccount) return

    const userRequest = buildTransferUserRequest({
      selectedAccount: this.selectedAccount,
      amount,
      selectedToken,
      recipientAddress
    })

    if (!userRequest) {
      this.emitError({
        level: 'major',
        message: 'Unexpected error while building transfer request',
        error: new Error(
          'buildUserRequestFromTransferRequest: bad parameters passed to buildTransferUserRequest'
        )
      })
      return
    }

    await this.addUserRequest(userRequest)
  }

  resolveUserRequest(data: any, requestId: UserRequest['id']) {
    const userRequest = this.userRequests.find((r) => r.id === requestId)
    if (!userRequest) return // TODO: emit error

    userRequest.dappPromise?.resolve(data)
    // These requests are transitionary initiated internally (not dApp requests) that block dApp requests
    // before being resolved. The timeout prevents the action-window from closing before the actual dApp request arrives
    if (['unlock', 'dappConnect'].includes(userRequest.action.kind)) {
      setTimeout(() => {
        this.removeUserRequest(requestId)
        this.emitUpdate()
      }, 300)
    } else {
      this.removeUserRequest(requestId)
      this.emitUpdate()
    }
  }

  rejectUserRequest(err: string, requestId: UserRequest['id']) {
    const userRequest = this.userRequests.find((r) => r.id === requestId)
    if (!userRequest) return // TODO: emit error

    if (requestId === ENTRY_POINT_AUTHORIZATION_REQUEST_ID) {
      this.userRequests = this.userRequests.filter(
        (r) =>
          !(
            r.action.kind === 'call' &&
            r.meta.accountAddr === userRequest.meta.accountAddr &&
            r.meta.networkId === userRequest.meta.networkId
          )
      )
    }

    userRequest.dappPromise?.reject(ethErrors.provider.userRejectedRequest<any>(err))
    this.removeUserRequest(requestId)
    this.emitUpdate()
  }

  async addUserRequest(req: UserRequest, withPriority?: boolean) {
    if (withPriority) {
      this.userRequests.unshift(req)
    } else {
      this.userRequests.push(req)
    }

    const { id, action, meta } = req
    if (action.kind === 'call') {
      // @TODO
      // one solution would be to, instead of checking, have a promise that we always await here, that is responsible for fetching
      // account data; however, this won't work with EOA accountOps, which have to always pick the first userRequest for a particular acc/network,
      // and be recalculated when one gets dismissed
      // although it could work like this: 1) await the promise, 2) check if exists 3) if not, re-trigger the promise;
      // 4) manage recalc on removeUserRequest too in order to handle EOAs
      // @TODO consider re-using this whole block in removeUserRequest
      await this.#ensureAccountInfo(meta.accountAddr, meta.networkId)
      if (this.signAccOpInitError) return

      const account = this.accounts.find((x) => x.addr === meta.accountAddr)!
      const accountState = this.accountStates[meta.accountAddr][meta.networkId]

      if (account.creation) {
        const network = this.networks.networks.filter((n) => n.id === meta.networkId)[0]
        if (shouldAskForEntryPointAuthorization(network, accountState)) {
          if (
            this.actions.visibleActionsQueue.find(
              (a) =>
                a.id === ENTRY_POINT_AUTHORIZATION_REQUEST_ID &&
                (a as SignMessageAction).userRequest.meta.networkId === meta.networkId
            )
          ) {
            this.emitUpdate()
            return
          }
          const typedMessageAction = await getEntryPointAuthorization(
            meta.accountAddr,
            network.chainId,
            BigInt(accountState.nonce)
          )
          await this.addUserRequest({
            id: ENTRY_POINT_AUTHORIZATION_REQUEST_ID,
            action: typedMessageAction,
            meta: {
              isSignAction: true,
              accountAddr: meta.accountAddr,
              networkId: meta.networkId
            },
            session: req.session,
            dappPromise: req?.dappPromise
              ? { reject: req?.dappPromise?.reject, resolve: () => {} }
              : undefined
          } as SignUserRequest)
          this.emitUpdate()
          return
        }

        const accountOpAction = makeSmartAccountOpAction({
          account,
          networkId: meta.networkId,
          nonce: accountState.nonce,
          userRequests: this.userRequests,
          actionsQueue: this.actions.actionsQueue
        })
        this.actions.addOrUpdateAction(accountOpAction, withPriority)
        if (this.signAccountOp && this.signAccountOp.fromActionId === accountOpAction.id) {
          this.signAccountOp.update({ accountOp: accountOpAction.accountOp })
          this.estimateSignAccountOp()
        }
      } else {
        const accountOpAction = makeBasicAccountOpAction({
          account,
          networkId: meta.networkId,
          nonce: accountState.nonce,
          userRequest: req
        })
        this.actions.addOrUpdateAction(accountOpAction, withPriority)
      }
    } else {
      let actionType: 'dappRequest' | 'benzin' | 'signMessage' = 'dappRequest'

      if (req.action.kind === 'typedMessage' || req.action.kind === 'message') {
        actionType = 'signMessage'

        if (this.actions.visibleActionsQueue.find((a) => a.type === 'signMessage')) {
          const msgReq = this.userRequests.find((uReq) => uReq.id === id)
          if (!msgReq) return
          msgReq.dappPromise?.reject(
            ethErrors.provider.custom({
              code: 1001,
              message:
                'Rejected: Please complete your pending message request before initiating a new one.'
            })
          )
          this.userRequests.splice(this.userRequests.indexOf(msgReq), 1)
          return
        }
      }
      if (req.action.kind === 'benzin') actionType = 'benzin'
      this.actions.addOrUpdateAction(
        {
          id,
          type: actionType,
          userRequest: req as UserRequest as never
        },
        withPriority
      )
    }

    this.emitUpdate()
  }

  // @TODO allow this to remove multiple OR figure out a way to debounce re-estimations
  // first one sounds more reasonable
  // although the second one can't hurt and can help (or no debounce, just a one-at-a-time queue)
  removeUserRequest(id: UserRequest['id']) {
    const req = this.userRequests.find((uReq) => uReq.id === id)
    if (!req) return

    // remove from the request queue
    this.userRequests.splice(this.userRequests.indexOf(req), 1)

    // update the pending stuff to be signed
    const { action, meta } = req
    if (action.kind === 'call') {
      const account = this.accounts.find((x) => x.addr === meta.accountAddr)
      if (!account)
        throw new Error(
          `batchCallsFromUserRequests: tried to run for non-existent account ${meta.accountAddr}`
        )

      if (account.creation) {
        const accountOpIndex = this.actions.actionsQueue.findIndex(
          (a) => a.type === 'accountOp' && a.id === `${meta.accountAddr}-${meta.networkId}`
        )
        const accountOpAction = this.actions.actionsQueue[accountOpIndex] as
          | AccountOpAction
          | undefined
        // accountOp has just been rejected
        if (!accountOpAction) {
          this.updateSelectedAccount(this.selectedAccount, true)
          this.emitUpdate()
          return
        }

        accountOpAction.accountOp.calls = this.#batchCallsFromUserRequests(
          meta.accountAddr,
          meta.networkId
        )
        if (accountOpAction.accountOp.calls.length) {
          this.actions.addOrUpdateAction(accountOpAction)

          if (this.signAccountOp && this.signAccountOp.fromActionId === accountOpAction.id) {
            this.signAccountOp.update({ accountOp: accountOpAction.accountOp, estimation: null })
            this.estimateSignAccountOp()
          }
        } else {
          this.actions.removeAction(`${meta.accountAddr}-${meta.networkId}`)
          this.updateSelectedAccount(this.selectedAccount, true)
        }
      } else {
        this.actions.removeAction(id)
        this.updateSelectedAccount(this.selectedAccount, true)
      }
    } else {
      this.actions.removeAction(id)
    }
    this.emitUpdate()
  }

  async addNetwork(network: AddNetworkRequestParams) {
    await this.networks.addNetwork(network)
    await this.updateSelectedAccount(this.selectedAccount, true)
  }

  async removeNetwork(id: NetworkId) {
    await this.networks.removeNetwork(id)
    await this.updateSelectedAccount(this.selectedAccount, true)
  }

  async resolveAccountOpAction(data: any, actionId: AccountOpAction['id']) {
    const accountOpAction = this.actions.actionsQueue.find((a) => a.id === actionId)
    if (!accountOpAction) return

    const { accountOp } = accountOpAction as AccountOpAction
    const meta: SignUserRequest['meta'] = {
      isSignAction: true,
      accountAddr: accountOp.accountAddr,
      networkId: accountOp.networkId,
      txnId: null,
      userOpHash: null
    }
    data?.isUserOp ? (meta.userOpHash = data.hash) : (meta.txnId = data.hash)
    const benzinUserRequest: SignUserRequest = {
      id: new Date().getTime(),
      action: { kind: 'benzin' },
      meta
    }
    await this.addUserRequest(benzinUserRequest, true)
    this.actions.removeAction(actionId)

    // eslint-disable-next-line no-restricted-syntax
    for (const call of accountOp.calls) {
      const uReq = this.userRequests.find((r) => r.id === call.fromUserRequestId)
      if (uReq) {
        uReq.dappPromise?.resolve(data)
        // eslint-disable-next-line no-await-in-loop
        this.removeUserRequest(uReq.id)
      }
    }

    this.emitUpdate()
  }

  rejectAccountOpAction(err: string, actionId: AccountOpAction['id']) {
    const accountOpAction = this.actions.actionsQueue.find((a) => a.id === actionId)
    if (!accountOpAction) return

    const { accountOp } = accountOpAction as AccountOpAction
    this.actions.removeAction(actionId)
    // eslint-disable-next-line no-restricted-syntax
    for (const call of accountOp.calls) {
      const uReq = this.userRequests.find((r) => r.id === call.fromUserRequestId)
      if (uReq) {
        uReq.dappPromise?.reject(ethErrors.provider.userRejectedRequest<any>(err))
        // eslint-disable-next-line no-await-in-loop
        this.removeUserRequest(uReq.id)
      }
    }
    this.emitUpdate()
  }

  async updateSignAccountOpGasPrice() {
    if (!this.signAccountOp) return
    const networkId = this.signAccountOp.accountOp.networkId

    await this.#updateGasPrice()

    // there's a chance signAccountOp gets destroyed between the time
    // the first "if (!this.signAccountOp) return" is performed and
    // the time we get here. To prevent issues, we check one more time
    if (!this.signAccountOp) return

    this.signAccountOp.update({ gasPrices: this.gasPrices[networkId] })
    this.emitUpdate()
  }

  // @TODO: protect this from race conditions/simultanous executions
  async estimateSignAccountOp() {
    try {
      if (!this.signAccountOp) return

      // make a local copy to avoid updating the main reference
      const localAccountOp: AccountOp = { ...this.signAccountOp.accountOp }

      await this.#initialLoadPromise
      // new accountOps should have spoof signatures so that they can be easily simulated
      // this is not used by the Estimator, because it iterates through all associatedKeys and
      // it knows which ones are authenticated, and it can generate it's own spoofSig
      // @TODO
      // accountOp.signature = `${}03`

      // TODO check if needed data in accountStates are available
      // this.accountStates[accountOp.accountAddr][accountOp.networkId].
      const account = this.accounts.find((x) => x.addr === localAccountOp.accountAddr)

      // Here, we list EOA accounts for which you can also obtain an estimation of the AccountOp payment.
      // In the case of operating with a smart account (an account with creation code), all other EOAs can pay the fee.
      //
      // If the current account is an EOA, only this account can pay the fee,
      // and there's no need for checking other EOA accounts native balances.
      // This is already handled and estimated as a fee option in the estimate library, which is why we pass an empty array here.
      const EOAaccounts = account?.creation ? this.accounts.filter((acc) => !acc.creation) : []

      if (!account)
        throw new Error(
          `estimateSignAccountOp: ${localAccountOp.accountAddr}: account does not exist`
        )
      const network = this.networks.networks.find((x) => x.id === localAccountOp.networkId)
      if (!network)
        throw new Error(
          `estimateSignAccountOp: ${localAccountOp.networkId}: network does not exist`
        )

      // Take the fee tokens from two places: the user's tokens and his gasTank
      // The gastTank tokens participate on each network as they belong everywhere
      // NOTE: at some point we should check all the "?" signs below and if
      // an error pops out, we should notify the user about it
      const networkFeeTokens =
        this.portfolio.latest?.[localAccountOp.accountAddr]?.[localAccountOp.networkId]?.result
          ?.tokens ?? []
      const gasTankFeeTokens =
        this.portfolio.latest?.[localAccountOp.accountAddr]?.gasTank?.result?.tokens ?? []

      const feeTokens =
        [...networkFeeTokens, ...gasTankFeeTokens].filter((t) => t.flags.isFeeToken) || []

      // if the network's chosen RPC supports debug_traceCall, we
      // make an additional simulation for each call in the accountOp
      let promises: any[] = []
      if (network.hasDebugTraceCall) {
        // 65gwei, try to make it work most of the times on ethereum
        let gasPrice = 65000000000n
        // calculate the fast gas price to use in simulation
        if (
          this.gasPrices[localAccountOp.networkId] &&
          this.gasPrices[localAccountOp.networkId].length
        ) {
          const fast = this.gasPrices[localAccountOp.networkId][2]
          gasPrice =
            'gasPrice' in fast ? fast.gasPrice : fast.baseFeePerGas + fast.maxPriorityFeePerGas
          // increase the gas price with 10% to try to get above the min baseFee
          gasPrice += gasPrice / 10n
        }
        // 200k, try to make it work most of the times on ethereum
        let gas = 200000n
        if (this.signAccountOp.estimation) {
          gas = this.signAccountOp.estimation.gasUsed
        }
        const provider = this.providers.providers[localAccountOp.networkId]
        promises = localAccountOp.calls.map((call) => {
          return provider
            .send('debug_traceCall', [
              {
                to: call.to,
                value: toQuantity(call.value.toString()),
                data: call.data,
                from: localAccountOp.accountAddr,
                gasPrice: toQuantity(gasPrice.toString()),
                gas: toQuantity(gas.toString())
              },
              'latest',
              {
                tracer:
                  "{data: [], fault: function (log) {}, step: function (log) { if (log.op.toString() === 'LOG3') { this.data.push([ toHex(log.contract.getAddress()), '0x' + ('0000000000000000000000000000000000000000' + log.stack.peek(4).toString(16)).slice(-40)])}}, result: function () { return this.data }}",
                enableMemory: false,
                enableReturnData: true,
                disableStorage: true
              }
            ])
            .catch((e: any) => {
              console.log(e)
              return [ZeroAddress]
            })
        })
      }
      const result = await Promise.all([
        ...promises,
        humanizeAccountOp(this.#storage, localAccountOp, this.#fetch, this.emitError)
      ])
      const humanization = result[result.length - 1]

      // Reverse lookup addresses and save them in memory so they
      // can be read from the UI
      humanization.forEach((call: any) => {
        if (!call.fullVisualization) return

        call.fullVisualization.forEach(async (visualization: any) => {
          if (visualization.type !== 'address' || !visualization.address) return

          await this.domains.reverseLookup(visualization.address)
        })
      })

      const additionalHints: GetOptions['additionalHints'] = humanization
        .map((call: any) =>
          !call.fullVisualization
            ? []
            : call.fullVisualization.map((vis: any) =>
                vis.address && isAddress(vis.address) ? getAddress(vis.address) : ''
              )
        )
        .flat()
        .filter((x: any) => isAddress(x))
      result.pop()
      const stringAddr: any = result.length ? result.flat(Infinity) : []
      additionalHints!.push(...stringAddr)

      await this.portfolio.learnTokens(additionalHints, network.id)

      const [, estimation] = await Promise.all([
        // NOTE: we are not emitting an update here because the portfolio controller will do that
        // NOTE: the portfolio controller has it's own logic of constructing/caching providers, this is intentional, as
        // it may have different needs
        this.portfolio.updateSelectedAccount(
          this.accounts,
          localAccountOp.accountAddr,
          undefined,
          this.signAccountOp
            ? { [localAccountOp.networkId]: [localAccountOp] }
            : getAccountOpsByNetwork(localAccountOp.accountAddr, this.actions.visibleActionsQueue),
          { forceUpdate: true }
        ),
        estimate(
          this.providers.providers[localAccountOp.networkId],
          network,
          account,
          this.keystore.keys,
          localAccountOp,
          this.accountStates,
          EOAaccounts,
          // @TODO - first time calling this, portfolio is still not loaded.
          feeTokens,
          {
            is4337Broadcast: isErc4337Broadcast(
              network,
              this.accountStates[localAccountOp.accountAddr][localAccountOp.networkId]
            )
          }
        ).catch((e) => {
          this.emitError({
            level: 'major',
            message: `Failed to estimate account op for ${localAccountOp.accountAddr} on ${localAccountOp.networkId}`,
            error: e
          })
          return null
        })
      ])

      // @race
      // if the signAccountOp has been deleted, don't continue as the request has already finished
      if (!this.signAccountOp) return

      // if the nonce from the estimation is different than the one in localAccountOp,
      // override all places that contain the old nonce with the correct one
      if (estimation && BigInt(estimation.currentAccountNonce) !== localAccountOp.nonce) {
        localAccountOp.nonce = BigInt(estimation.currentAccountNonce)

        this.signAccountOp.accountOp.nonce = localAccountOp.nonce

        if (this.accountStates?.[localAccountOp.accountAddr]?.[localAccountOp.networkId])
          this.accountStates[localAccountOp.accountAddr][localAccountOp.networkId].nonce =
            localAccountOp.nonce
      }

      // update the signAccountOp controller once estimation finishes;
      // this eliminates the infinite loading bug if the estimation comes slower
      if (this.signAccountOp && estimation) {
        this.signAccountOp.update({ estimation })
      }

      // if there's an estimation error, override the pending results
      if (estimation && estimation.error) {
        this.portfolio.overridePendingResults(localAccountOp)
      }
    } catch (error: any) {
      this.emitError({
        level: 'silent',
        message: 'Estimation error',
        error
      })
    }
  }

  /**
   * There are 4 ways to broadcast an AccountOp:
   *   1. For basic accounts (EOA), there is only one way to do that. After
   *   signing the transaction, the serialized signed transaction object gets
   *   send to the network.
   *   2. For smart accounts, when EOA pays the fee. Two signatures are needed
   *   for this. The first one is the signature of the AccountOp itself. The
   *   second one is the signature of the transaction that will be executed
   *   by the smart account.
   *   3. For smart accounts that broadcast the ERC-4337 way.
   *   4. for smart accounts, when the Relayer does the broadcast.
   *
   */
  async broadcastSignedAccountOp(
    accountOp: AccountOp,
    estimation: EstimateResult,
    actionId: AccountOpAction['id']
  ) {
    this.broadcastStatus = 'LOADING'
    this.emitUpdate()

    if (!accountOp.signingKeyAddr || !accountOp.signingKeyType || !accountOp.signature) {
      return this.#throwAccountOpBroadcastError(new Error('AccountOp missing props'))
    }

    const provider = this.providers.providers[accountOp.networkId]
    const account = this.accounts.find((acc) => acc.addr === accountOp.accountAddr)
    const network = this.networks.networks.find((n) => n.id === accountOp.networkId)

    if (!provider) {
      return this.#throwAccountOpBroadcastError(
        new Error(`Provider for networkId: ${accountOp.networkId} not found`)
      )
    }

    if (!account) {
      return this.#throwAccountOpBroadcastError(
        new Error(`Account with address: ${accountOp.accountAddr} not found`)
      )
    }

    if (!network) {
      return this.#throwAccountOpBroadcastError(
        new Error(`Network with id: ${accountOp.networkId} not found`)
      )
    }

    let transactionRes: TransactionResponse | { hash: string; nonce: number } | null = null
    const feeTokenEstimation = estimation.feePaymentOptions.find(
      (option) =>
        option.token.address === accountOp.gasFeePayment?.inToken &&
        option.paidBy === accountOp.gasFeePayment?.paidBy
    )!

    // Basic account (EOA)
    if (!isSmartAccount(account)) {
      try {
        const feePayerKeys = this.keystore.keys.filter(
          (key) => key.addr === accountOp.gasFeePayment!.paidBy
        )
        const feePayerKey =
          // Temporarily prioritize the key with the same type as the signing key.
          // TODO: Implement a way to choose the key type to broadcast with.
          feePayerKeys.find((key) => key.type === accountOp.signingKeyType) || feePayerKeys[0]
        if (!feePayerKey) {
          return this.#throwAccountOpBroadcastError(
            new Error(
              `Key with address: ${accountOp.gasFeePayment!.paidBy} for account with address: ${
                accountOp.accountAddr
              } not found`
            )
          )
        }
        const signer = await this.keystore.getSigner(feePayerKey.addr, feePayerKey.type)
        if (signer.init) signer.init(this.#externalSignerControllers[feePayerKey.type])

        const gasFeePayment = accountOp.gasFeePayment!
        const { to, value, data } = accountOp.calls[0]
        const rawTxn: TxnRequest = {
          to,
          value,
          data,
          chainId: network!.chainId,
          nonce: await provider.getTransactionCount(accountOp.accountAddr),
          gasLimit: gasFeePayment.simulatedGasLimit
        }

        // if it's eip1559, send it as such. If no, go to legacy
        const gasPrice =
          (gasFeePayment.amount - feeTokenEstimation.addedNative) / gasFeePayment.simulatedGasLimit
        if (gasFeePayment.maxPriorityFeePerGas !== undefined) {
          rawTxn.maxFeePerGas = gasPrice
          rawTxn.maxPriorityFeePerGas = gasFeePayment.maxPriorityFeePerGas
          rawTxn.type = 2
        } else {
          rawTxn.gasPrice = gasPrice
          rawTxn.type = 0
        }

        const signedTxn = await signer.signRawTransaction(rawTxn)
        try {
          transactionRes = await provider.broadcastTransaction(signedTxn)
        } catch (e: any) {
          const reason = e?.message || 'unknown'

          throw new Error(
            `Transaction couldn't be broadcasted on the ${network.name} network. Reason: ${reason}`
          )
        }
      } catch (e: any) {
        return this.#throwAccountOpBroadcastError(e)
      }
    }
    // Smart account but EOA pays the fee
    else if (
      account.creation &&
      accountOp.gasFeePayment &&
      accountOp.gasFeePayment.paidBy !== account.addr
    ) {
      const feePayerKeys = this.keystore.keys.filter(
        (key) => key.addr === accountOp.gasFeePayment!.paidBy
      )
      const feePayerKey =
        // Temporarily prioritize the key with the same type as the signing key.
        // TODO: Implement a way to choose the key type to broadcast with.
        feePayerKeys.find((key) => key.type === accountOp.signingKeyType) || feePayerKeys[0]
      if (!feePayerKey) {
        return this.#throwAccountOpBroadcastError(
          new Error(
            `Key with address: ${accountOp.gasFeePayment!.paidBy} for account with address: ${
              accountOp.accountAddr
            } not found`
          )
        )
      }

      const accountState = this.accountStates[accountOp.accountAddr][accountOp.networkId]
      let data
      let to
      if (accountState.isDeployed) {
        const ambireAccount = new Interface(AmbireAccount.abi)
        to = accountOp.accountAddr
        data = ambireAccount.encodeFunctionData('execute', [
          getSignableCalls(accountOp),
          accountOp.signature
        ])
      } else {
        const ambireFactory = new Interface(AmbireFactory.abi)
        to = account.creation.factoryAddr
        data = ambireFactory.encodeFunctionData('deployAndExecute', [
          account.creation.bytecode,
          account.creation.salt,
          getSignableCalls(accountOp),
          accountOp.signature
        ])
      }

      try {
        const signer = await this.keystore.getSigner(feePayerKey.addr, feePayerKey.type)
        if (signer.init) signer.init(this.#externalSignerControllers[feePayerKey.type])

        const gasPrice =
          (accountOp.gasFeePayment.amount - feeTokenEstimation.addedNative) /
          accountOp.gasFeePayment.simulatedGasLimit
        const rawTxn: TxnRequest = {
          to,
          data,
          // We ultimately do a smart contract call, which means we don't need
          // to send any `value` from the EOA address. The actual `value` will
          // get taken from the value encoded in the `data` field.
          value: BigInt(0),
          chainId: network.chainId,
          nonce: await provider.getTransactionCount(accountOp.gasFeePayment!.paidBy),
          gasLimit: accountOp.gasFeePayment.simulatedGasLimit
        }

        if (accountOp.gasFeePayment.maxPriorityFeePerGas !== undefined) {
          rawTxn.maxFeePerGas = gasPrice
          rawTxn.maxPriorityFeePerGas = accountOp.gasFeePayment.maxPriorityFeePerGas
          rawTxn.type = 2
        } else {
          rawTxn.gasPrice = gasPrice
          rawTxn.type = 0
        }

        const signedTxn = await signer.signRawTransaction(rawTxn)
        try {
          transactionRes = await provider.broadcastTransaction(signedTxn)
        } catch (e: any) {
          const reason = e?.message || 'unknown'

          throw new Error(
            `Transaction couldn't be broadcasted on the ${network.name} network. Reason: ${reason}`
          )
        }
      } catch (e: any) {
        return this.#throwAccountOpBroadcastError(e)
      }
    }
    // Smart account, the ERC-4337 way
    else if (accountOp.gasFeePayment && accountOp.gasFeePayment.isERC4337) {
      const userOperation = accountOp.asUserOperation
      if (!userOperation) {
        return this.#throwAccountOpBroadcastError(
          new Error(
            `Trying to broadcast an ERC-4337 request but userOperation is not set for ${accountOp.accountAddr}`
          )
        )
      }

      // broadcast through bundler's service
      let userOperationHash
      try {
        userOperationHash = await bundler.broadcast(userOperation, network!)
      } catch (e: any) {
        return this.#throwAccountOpBroadcastError(
          new Error(
            Bundler.decodeBundlerError(
              e,
              'Bundler broadcast failed. Please try broadcasting by an EOA or contact support'
            )
          )
        )
      }
      if (!userOperationHash) {
        return this.#throwAccountOpBroadcastError(
          new Error(
            'Bundler broadcast failed. Please try broadcasting by an EOA or contact support'
          )
        )
      }

      // broadcast the userOperationHash
      transactionRes = {
        hash: userOperationHash,
        nonce: Number(userOperation.nonce)
      }
    }
    // Smart account, the Relayer way
    else {
      try {
        const body = {
          gasLimit: Number(accountOp.gasFeePayment!.simulatedGasLimit),
          txns: getSignableCalls(accountOp),
          signature: accountOp.signature,
          signer: { address: accountOp.signingKeyAddr },
          nonce: Number(accountOp.nonce)
        }
        const response = await this.#callRelayer(
          `/identity/${accountOp.accountAddr}/${accountOp.networkId}/submit`,
          'POST',
          body
        )
        transactionRes = {
          hash: response.txId,
          nonce: Number(accountOp.nonce)
        }
      } catch (e: any) {
        return this.#throwAccountOpBroadcastError(e)
      }
    }

    if (transactionRes) {
      const submittedAccountOp: SubmittedAccountOp = {
        ...accountOp,
        status: AccountOpStatus.BroadcastedButNotConfirmed,
        txnId: transactionRes.hash,
        nonce: BigInt(transactionRes.nonce),
        timestamp: new Date().getTime(),
        isSingletonDeploy: !!accountOp.calls.find((call) => getAddress(call.to) === SINGLETON)
      }
      if (accountOp.gasFeePayment?.isERC4337) {
        submittedAccountOp.userOpHash = transactionRes.hash
      }
      await this.activity.addAccountOp(submittedAccountOp)
      await this.resolveAccountOpAction(
        {
          hash: transactionRes?.hash || null,
          networkId: network.id,
          isUserOp: !!accountOp?.asUserOperation
        },
        actionId
      )

      console.log('broadcasted:', transactionRes)
      !!this.onBroadcastSuccess && this.onBroadcastSuccess('account-op')
      this.broadcastStatus = 'DONE'
      this.emitUpdate()
      await wait(1)
    }

    this.broadcastStatus = 'INITIAL'
    this.emitUpdate()
  }

  async broadcastSignedMessage(signedMessage: SignedMessage) {
    this.broadcastStatus = 'LOADING'
    this.emitUpdate()

    await this.activity.addSignedMessage(signedMessage, signedMessage.accountAddr)
    if (signedMessage.fromActionId === ENTRY_POINT_AUTHORIZATION_REQUEST_ID) {
      const accountOpAction = makeSmartAccountOpAction({
        account: this.accounts.filter((a) => a.addr === signedMessage.accountAddr)[0],
        networkId: signedMessage.networkId,
        nonce: this.accountStates[signedMessage.accountAddr][signedMessage.networkId].nonce,
        userRequests: this.userRequests,
        actionsQueue: this.actions.actionsQueue
      })
      if (!accountOpAction.accountOp.meta) accountOpAction.accountOp.meta = {}
      accountOpAction.accountOp.meta.entryPointAuthorization = adjustEntryPointAuthorization(
        signedMessage.signature as string
      )

      this.actions.addOrUpdateAction(accountOpAction, true)
    }
    await this.resolveUserRequest({ hash: signedMessage.signature }, signedMessage.fromActionId)
    !!this.onBroadcastSuccess &&
      this.onBroadcastSuccess(
        signedMessage.content.kind === 'typedMessage' ? 'typed-data' : 'message'
      )

    this.broadcastStatus = 'DONE'
    this.emitUpdate()

    await wait(1)
    this.broadcastStatus = 'INITIAL'
    this.emitUpdate()
  }

  // ! IMPORTANT !
  // Banners that depend on async data from sub-controllers should be implemented
  // in the sub-controllers themselves. This is because updates in the sub-controllers
  // will not trigger emitUpdate in the MainController, therefore the banners will
  // remain the same until a subsequent update in the MainController.
  get banners(): Banner[] {
    if (!this.selectedAccount || !this.networks.isInitialized) return []

    const accountOpBanners = getAccountOpBanners({
      accountOpActionsByNetwork: getAccountOpActionsByNetwork(
        this.selectedAccount,
        this.actions.actionsQueue
      ),
      selectedAccount: this.selectedAccount,
      accounts: this.accounts,
      networks: this.networks.networks
    })

    return [...accountOpBanners]
  }

  #throwAccountOpBroadcastError(error: Error) {
    let message =
      error?.message ||
      'Unable to broadcast the transaction. Please try again or contact Ambire support if the issue persists.'

    if (message) {
      if (message.includes('insufficient funds')) {
        // TODO: Better message?
        message = 'Insufficient funds for intristic transaction cost'
      } else {
        message = message.length > 300 ? `${message.substring(0, 300)}...` : message
      }
    }

    this.emitError({ level: 'major', message, error })
    // To enable another try for signing in case of broadcast fail
    // broadcast is called in the FE only after successful signing
    this.signAccountOp?.updateStatusToReadyToSign()
    this.broadcastStatus = 'INITIAL'
    this.emitUpdate()
  }

  // includes the getters in the stringified instance
  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      banners: this.banners
    }
  }
}
