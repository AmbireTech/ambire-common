/* eslint-disable @typescript-eslint/brace-style */
import { ethErrors } from 'eth-rpc-errors'

import AmbireAccount7702 from '../../../contracts/compiled/AmbireAccount7702.json'
import EmittableError from '../../classes/EmittableError'
import { Session } from '../../classes/session'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import {
  BIP44_LEDGER_DERIVATION_TEMPLATE,
  BIP44_STANDARD_DERIVATION_TEMPLATE
} from '../../consts/derivation'
import { FeatureFlags } from '../../consts/featureFlags'
import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { Account, IAccountsController } from '../../interfaces/account'
import { IAccountPickerController } from '../../interfaces/accountPicker'
import { AccountOpAction } from '../../interfaces/actions'
import { IActivityController } from '../../interfaces/activity'
import { IAddressBookController } from '../../interfaces/addressBook'
import { IBannerController } from '../../interfaces/banner'
import { IContractNamesController } from '../../interfaces/contractNames'
import { IDappsController } from '../../interfaces/dapp'
import { IDefiPositionsController } from '../../interfaces/defiPositions'
import { IDomainsController } from '../../interfaces/domains'
import { IEmailVaultController } from '../../interfaces/emailVault'
import { ErrorRef } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { Fetch } from '../../interfaces/fetch'
import { Hex } from '../../interfaces/hex'
import { IInviteController } from '../../interfaces/invite'
import {
  ExternalSignerControllers,
  IKeystoreController,
  Key,
  KeystoreSignerType
} from '../../interfaces/keystore'
import { IMainController, STATUS_WRAPPED_METHODS, StatusesWithCustom } from '../../interfaces/main'
import { AddNetworkRequestParams, INetworksController, Network } from '../../interfaces/network'
import { IPhishingController } from '../../interfaces/phishing'
import { Platform } from '../../interfaces/platform'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { IRequestsController } from '../../interfaces/requests'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { ISignAccountOpController, TraceCallDiscoveryStatus } from '../../interfaces/signAccountOp'
import { ISignMessageController } from '../../interfaces/signMessage'
import { IStorageController, Storage } from '../../interfaces/storage'
import { ISwapAndBridgeController, SwapAndBridgeActiveRoute } from '../../interfaces/swapAndBridge'
import { ITransactionManagerController } from '../../interfaces/transactionManager'
import { ITransferController } from '../../interfaces/transfer'
import { IUiController, UiManager, View } from '../../interfaces/ui'
import { Calls, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import { getDefaultSelectedAccount, isBasicAccount } from '../../libs/account/account'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { getDappIdentifier, SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
import { getAccountOpFromAction } from '../../libs/actions/actions'
/* eslint-disable no-await-in-loop */
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { getAccountOpsForSimulation } from '../../libs/main/main'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { makeAccountOpAction } from '../../libs/requests/requests'
import { isNetworkReady } from '../../libs/selectedAccount/selectedAccount'
import { debugTraceCall } from '../../libs/tracer/debugTraceCall'
/* eslint-disable no-underscore-dangle */
import { LiFiAPI } from '../../services/lifi/api'
import { paymasterFactory } from '../../services/paymaster'
import { SocketAPI } from '../../services/socket/api'
import { SwapProviderParallelExecutor } from '../../services/swapIntegrators/swapProviderParallelExecutor'
import { getHdPathFromTemplate } from '../../utils/hdPath'
import wait from '../../utils/wait'
import { AccountPickerController } from '../accountPicker/accountPicker'
import { AccountsController } from '../accounts/accounts'
import { ActivityController } from '../activity/activity'
import { AddressBookController } from '../addressBook/addressBook'
import { BannerController } from '../banner/banner'
import { ContinuousUpdatesController } from '../continuousUpdates/continuousUpdates'
import { ContractNamesController } from '../contractNames/contractNames'
import { DappsController } from '../dapps/dapps'
import { DefiPositionsController } from '../defiPositions/defiPositions'
import { DomainsController } from '../domains/domains'
import { EmailVaultController } from '../emailVault/emailVault'
import { EstimationStatus } from '../estimation/types'
import EventEmitter from '../eventEmitter/eventEmitter'
import { FeatureFlagsController } from '../featureFlags/featureFlags'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PhishingController } from '../phishing/phishing'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { RequestsController } from '../requests/requests'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { SignAccountOpType } from '../signAccountOp/helper'
import { SignAccountOpController } from '../signAccountOp/signAccountOp'
import { SignMessageController } from '../signMessage/signMessage'
import { StorageController } from '../storage/storage'
import { SwapAndBridgeController } from '../swapAndBridge/swapAndBridge'
import { TransactionManagerController } from '../transaction/transactionManager'
import { TransferController } from '../transfer/transfer'
import { UiController } from '../ui/ui'

export class MainController extends EventEmitter implements IMainController {
  #storageAPI: Storage

  fetch: Fetch

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  callRelayer: Function

  isReady: boolean = false

  /**
   * Hardware wallets (usually) need an additional (external signer) controller,
   * that is app-specific (web, mobile) and is used to interact with the device.
   * (example: LedgerController, TrezorController, LatticeController)
   */
  #externalSignerControllers: ExternalSignerControllers = {}

  // sub-controllers

  storage: IStorageController

  featureFlags: IFeatureFlagsController

  invite: IInviteController

  keystore: IKeystoreController

  networks: INetworksController

  providers: IProvidersController

  accountPicker: IAccountPickerController

  portfolio: IPortfolioController

  defiPositions: IDefiPositionsController

  dapps: IDappsController

  phishing: IPhishingController

  emailVault?: IEmailVaultController

  signMessage: ISignMessageController

  swapAndBridge: ISwapAndBridgeController

  transactionManager?: ITransactionManagerController

  transfer: ITransferController

  signAccountOp: ISignAccountOpController | null = null

  signAccOpInitError: string | null = null

  activity: IActivityController

  addressBook: IAddressBookController

  domains: IDomainsController

  contractNames: IContractNamesController

  accounts: IAccountsController

  selectedAccount: ISelectedAccountController

  requests: IRequestsController

  banner: IBannerController

  accountOpsToBeConfirmed: { [key: string]: { [key: string]: AccountOp } } = {}

  lastUpdate: Date = new Date()

  isOffline: boolean = false

  statuses: StatusesWithCustom = STATUS_WRAPPED_METHODS

  ui: IUiController

  #continuousUpdates: ContinuousUpdatesController

  get continuousUpdates() {
    return this.#continuousUpdates
  }

  #traceCallTimeoutId: ReturnType<typeof setTimeout> | null = null

  constructor({
    platform,
    storageAPI,
    fetch,
    relayerUrl,
    velcroUrl,
    liFiApiKey,
    bungeeApiKey,
    featureFlags,
    keystoreSigners,
    externalSignerControllers,
    uiManager
  }: {
    platform: Platform
    storageAPI: Storage
    fetch: Fetch
    relayerUrl: string
    velcroUrl: string
    liFiApiKey: string
    bungeeApiKey: string
    featureFlags: Partial<FeatureFlags>
    keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>
    externalSignerControllers: ExternalSignerControllers
    uiManager: UiManager
  }) {
    super()
    this.#storageAPI = storageAPI
    this.fetch = fetch

    this.storage = new StorageController(this.#storageAPI)
    this.featureFlags = new FeatureFlagsController(featureFlags)
    this.ui = new UiController({ uiManager })
    this.invite = new InviteController({ relayerUrl, fetch, storage: this.storage })
    this.keystore = new KeystoreController(platform, this.storage, keystoreSigners, this.ui)
    this.#externalSignerControllers = externalSignerControllers
    this.networks = new NetworksController({
      defaultNetworksMode: this.featureFlags.isFeatureEnabled('testnetMode')
        ? 'testnet'
        : 'mainnet',
      storage: this.storage,
      fetch,
      relayerUrl,
      onAddOrUpdateNetworks: async (networks: Network[]) => {
        networks.forEach((n) => n.disabled && this.removeNetworkData(n.chainId))
        networks.filter((net) => !net.disabled).forEach((n) => this.providers.setProvider(n))
        await this.reloadSelectedAccount({
          chainIds: networks.map((n) => n.chainId)
        })
      },
      onRemoveNetwork: (chainId: bigint) => {
        this.providers.removeProvider(chainId)
      }
    })

    this.providers = new ProvidersController(this.networks)
    this.accounts = new AccountsController(
      this.storage,
      this.providers,
      this.networks,
      this.keystore,
      async (accounts) => {
        const defaultSelectedAccount = getDefaultSelectedAccount(accounts)
        if (defaultSelectedAccount) {
          await this.#selectAccount(defaultSelectedAccount.addr)
        }
      },
      this.providers.updateProviderIsWorking.bind(this.providers),
      this.#updateIsOffline.bind(this)
    )
    this.selectedAccount = new SelectedAccountController({
      storage: this.storage,
      accounts: this.accounts,
      keystore: this.keystore
    })
    this.banner = new BannerController(this.storage)
    this.portfolio = new PortfolioController(
      this.storage,
      this.fetch,
      this.providers,
      this.networks,
      this.accounts,
      this.keystore,
      relayerUrl,
      velcroUrl,
      this.banner
    )
    this.defiPositions = new DefiPositionsController({
      fetch: this.fetch,
      storage: this.storage,
      selectedAccount: this.selectedAccount,
      keystore: this.keystore,
      accounts: this.accounts,
      networks: this.networks,
      providers: this.providers,
      ui: this.ui
    })
    if (this.featureFlags.isFeatureEnabled('withEmailVaultController')) {
      this.emailVault = new EmailVaultController(
        this.storage,
        this.fetch,
        relayerUrl,
        this.keystore
      )
    }
    this.accountPicker = new AccountPickerController({
      accounts: this.accounts,
      keystore: this.keystore,
      networks: this.networks,
      providers: this.providers,
      externalSignerControllers: this.#externalSignerControllers,
      relayerUrl,
      fetch: this.fetch,
      /**
       * callback that gets triggered as a finalization step of adding new
       * accounts via the AccountPickerController.
       *
       * VIEW-ONLY ACCOUNTS: In case of changes in this method, make sure these
       * changes are reflected for view-only accounts as well. Because the
       * view-only accounts import flow bypasses the AccountPicker, this method
       * won't click for them. Their on add success flow continues in the
       * MAIN_CONTROLLER_ADD_VIEW_ONLY_ACCOUNTS action case.
       */
      onAddAccountsSuccessCallback: this.#onAccountPickerSuccess.bind(this)
    })
    this.addressBook = new AddressBookController(this.storage, this.accounts, this.selectedAccount)
    this.signMessage = new SignMessageController(
      this.keystore,
      this.providers,
      this.networks,
      this.accounts,
      this.#externalSignerControllers,
      this.invite
    )
    this.phishing = new PhishingController({
      fetch: this.fetch,
      storage: this.storage,
      ui: this.ui
    })
    this.dapps = new DappsController(this.storage)

    this.selectedAccount.initControllers({
      portfolio: this.portfolio,
      defiPositions: this.defiPositions,
      networks: this.networks,
      providers: this.providers
    })

    this.callRelayer = relayerCall.bind({ url: relayerUrl, fetch: this.fetch })
    this.activity = new ActivityController(
      this.storage,
      this.fetch,
      this.callRelayer,
      this.accounts,
      this.selectedAccount,
      this.providers,
      this.networks,
      this.portfolio,
      async (network: Network) => {
        await this.setContractsDeployedToTrueIfDeployed(network)
      }
    )
    const LiFiProvider = new LiFiAPI({ fetch, apiKey: liFiApiKey })
    const SocketProvider = new SocketAPI({ fetch, apiKey: bungeeApiKey })
    this.swapAndBridge = new SwapAndBridgeController({
      callRelayer: this.callRelayer,
      accounts: this.accounts,
      keystore: this.keystore,
      portfolio: this.portfolio,
      externalSignerControllers: this.#externalSignerControllers,
      providers: this.providers,
      selectedAccount: this.selectedAccount,
      networks: this.networks,
      activity: this.activity,
      invite: this.invite,
      storage: this.storage,
      swapProvider: new SwapProviderParallelExecutor([LiFiProvider, SocketProvider]),
      relayerUrl,
      portfolioUpdate: (chainsToUpdate: Network['chainId'][]) => {
        if (chainsToUpdate.length) {
          const networks = chainsToUpdate
            ? this.networks.networks.filter((n) => chainsToUpdate.includes(n.chainId))
            : undefined

          this.updateSelectedAccountPortfolio({ networks })
        }
      },
      isMainSignAccountOpThrowingAnEstimationError: (
        fromChainId: number | null,
        toChainId: number | null
      ) => {
        return (
          this.signAccountOp &&
          fromChainId &&
          toChainId &&
          this.signAccountOp.estimation.status === EstimationStatus.Error &&
          this.signAccountOp.accountOp.chainId === BigInt(fromChainId) &&
          fromChainId === toChainId
        )
      },
      getUserRequests: () => this.requests.userRequests || [],
      getVisibleActionsQueue: () => this.requests.actions.visibleActionsQueue || [],
      onBroadcastSuccess: this.#handleBroadcastSuccess.bind(this),
      onBroadcastFailed: this.#handleBroadcastFailed.bind(this)
    })
    this.transfer = new TransferController(
      this.callRelayer,
      this.storage,
      humanizerInfo as HumanizerMeta,
      this.selectedAccount,
      this.networks,
      this.addressBook,
      this.accounts,
      this.keystore,
      this.portfolio,
      this.activity,
      this.#externalSignerControllers,
      this.providers,
      relayerUrl,
      this.#handleBroadcastSuccess.bind(this)
    )
    this.domains = new DomainsController(
      this.providers.providers,
      this.networks.defaultNetworksMode
    )

    this.contractNames = new ContractNamesController(this.fetch)

    if (this.featureFlags.isFeatureEnabled('withTransactionManagerController')) {
      // TODO: [WIP] - The manager should be initialized with transfer and swap and bridge controller dependencies.
      this.transactionManager = new TransactionManagerController({
        accounts: this.accounts,
        keystore: this.keystore,
        portfolio: this.portfolio,
        externalSignerControllers: this.#externalSignerControllers,
        providers: this.providers,
        selectedAccount: this.selectedAccount,
        networks: this.networks,
        activity: this.activity,
        invite: this.invite,
        // TODO<Bobby>: will need help configuring this once the plan forward is clear
        serviceProviderAPI: LiFiProvider,
        storage: this.storage,
        portfolioUpdate: this.updateSelectedAccountPortfolio.bind(this)
      })
    }

    this.requests = new RequestsController({
      relayerUrl,
      accounts: this.accounts,
      networks: this.networks,
      providers: this.providers,
      selectedAccount: this.selectedAccount,
      keystore: this.keystore,
      dapps: this.dapps,
      transfer: this.transfer,
      swapAndBridge: this.swapAndBridge,
      ui: this.ui,
      transactionManager: this.transactionManager,
      getSignAccountOp: () => this.signAccountOp,
      getMainStatuses: () => this.statuses,
      updateSignAccountOp: (props) => {
        if (!this.signAccountOp) return
        this.signAccountOp.update(props)
      },
      destroySignAccountOp: this.destroySignAccOp.bind(this),
      updateSelectedAccountPortfolio: async (networks) => {
        await this.updateSelectedAccountPortfolio({ networks })
      },
      addTokensToBeLearned: this.portfolio.addTokensToBeLearned.bind(this.portfolio),
      guardHWSigning: this.#guardHWSigning.bind(this)
    })

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })

    this.#continuousUpdates = new ContinuousUpdatesController({
      // Pass a read-only proxy of the main instance to ContinuousUpdatesController.
      // This gives it full access to read main’s state and call its methods,
      // but prevents any direct modification to the main state.
      main: new Proxy(this, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver)
          if (typeof value === 'function') {
            return value.bind(target) // bind original instance to preserve `this`
          }
          return value
        },
        set() {
          throw new Error('Read-only')
        }
      })
    })
    paymasterFactory.init(relayerUrl, fetch, (e: ErrorRef) => {
      if (!this.signAccountOp) return
      this.emitError(e)
    })

    this.keystore.onUpdate(() => {
      if (this.keystore.statuses.unlockWithSecret === 'SUCCESS') {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.storage.associateAccountKeysWithLegacySavedSeedMigration(
          () =>
            new AccountPickerController({
              accounts: this.accounts,
              keystore: this.keystore,
              networks: this.networks,
              providers: this.providers,
              externalSignerControllers: this.#externalSignerControllers,
              relayerUrl,
              fetch: this.fetch,
              onAddAccountsSuccessCallback: async () => {}
            }),
          this.keystore,
          async () => {
            await this.keystore.updateKeystoreKeys()
          }
        )
      }
    })

    this.ui.uiEvent.on('addView', async (view: View) => {
      if (view.type === 'popup') await this.onPopupOpen(view.id)
    })
  }

  /**
   * - Updates the selected account's account state, portfolio and defi positions
   * - Calls batchReverseLookup for all accounts
   *
   * It's not a problem to call it many times consecutively as all methods have internal
   * caching mechanisms to prevent unnecessary calls.
   */
  async onPopupOpen(viewId: string) {
    const selectedAccountAddr = this.selectedAccount.account?.addr

    if (selectedAccountAddr) {
      const FIVE_MINUTES = 1000 * 60 * 5
      this.domains.batchReverseLookup(this.accounts.accounts.map((a) => a.addr))
      if (!this.activity.broadcastedButNotConfirmed.length) {
        this.selectedAccount.resetSelectedAccountPortfolio({ maxDataAgeMs: FIVE_MINUTES })
        this.updateSelectedAccountPortfolio({ maxDataAgeMs: FIVE_MINUTES })
        this.defiPositions.updatePositions({ maxDataAgeMs: FIVE_MINUTES })
      }

      if (!this.accounts.areAccountStatesLoading) {
        this.accounts.updateAccountState(selectedAccountAddr)
      }
    }

    this.ui.updateView(viewId, { isReady: true })
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
    await this.accounts.initialLoadPromise
    await this.selectedAccount.initialLoadPromise

    this.defiPositions.updatePositions()
    this.updateSelectedAccountPortfolio()
    this.domains.batchReverseLookup(this.accounts.accounts.map((a) => a.addr))

    this.isReady = true
    this.emitUpdate()
  }

  lock() {
    this.keystore.lock()
    this.emailVault?.cleanMagicAndSessionKeys()
    this.selectedAccount.setDashboardNetworkFilter(null)
  }

  async selectAccount(toAccountAddr: string) {
    await this.withStatus('selectAccount', async () => this.#selectAccount(toAccountAddr), true)
  }

  async #selectAccount(toAccountAddr: string | null) {
    await this.initialLoadPromise
    if (!toAccountAddr) {
      await this.selectedAccount.setAccount(null)

      this.emitUpdate()
      return
    }

    const accountToSelect = this.accounts.accounts.find((acc) => acc.addr === toAccountAddr)
    if (!accountToSelect) {
      console.error(`Account with address ${toAccountAddr} does not exist`)
      return
    }

    this.isOffline = false
    // call closeActionWindow while still on the currently selected account to allow proper
    // state cleanup of the controllers like actionsCtrl, signAccountOpCtrl, signMessageCtrl...
    if (this.requests.actions?.currentAction?.type !== 'switchAccount') {
      await this.requests.actions.closeActionWindow()
    }
    const swapAndBridgeSigningAction = this.requests.actions.visibleActionsQueue.find(
      ({ type }) => type === 'swapAndBridge'
    )
    if (swapAndBridgeSigningAction) {
      await this.requests.actions.removeActions([swapAndBridgeSigningAction.id])
    }
    await this.selectedAccount.setAccount(accountToSelect)
    this.#continuousUpdates.updatePortfolioInterval.restart()
    this.#continuousUpdates.accountStateLatestInterval.restart()
    this.#continuousUpdates.accountStatePendingInterval.restart()
    this.#continuousUpdates.accountsOpsStatusesInterval.restart({ runImmediately: true })
    this.swapAndBridge.reset()
    this.transfer.resetForm()

    // forceEmitUpdate to update the getters in the FE state of the ctrls
    await Promise.all([
      this.requests.actions.forceEmitUpdate(),
      this.addressBook.forceEmitUpdate(),
      this.dapps.broadcastDappSessionEvent('accountsChanged', [toAccountAddr]),
      this.forceEmitUpdate()
    ])
    // Don't await these as they are not critical for the account selection
    // and if the user decides to quickly change to another account withStatus
    // will block the UI until these are resolved.
    this.reloadSelectedAccount({
      maxDataAgeMs: 5 * 60 * 1000,
      resetSelectedAccountPortfolio: false
    })
  }

  async #onAccountPickerSuccess() {
    // Add accounts first, because some of the next steps have validation
    // if accounts exists.
    if (this.accountPicker.readyToRemoveAccounts) {
      // eslint-disable-next-line no-restricted-syntax
      for (const acc of this.accountPicker.readyToRemoveAccounts) {
        await this.#removeAccount(acc.addr)
      }
    }

    await this.accounts.addAccounts(this.accountPicker.readyToAddAccounts)

    if (this.keystore.isKeyIteratorInitializedWithTempSeed(this.accountPicker.keyIterator)) {
      await this.keystore.persistTempSeed()
    }

    const storedSeed = await this.keystore.getKeystoreSeed(this.accountPicker.keyIterator)

    if (storedSeed) {
      this.keystore.updateSeed({
        id: storedSeed.id,
        hdPathTemplate: this.accountPicker.hdPathTemplate
      })

      this.accountPicker.readyToAddKeys.internal = this.accountPicker.readyToAddKeys.internal.map(
        (key) => ({ ...key, meta: { ...key.meta, fromSeedId: storedSeed.id } })
      )
    }
    // Then add keys, because some of the next steps could have validation
    // if keys exists. Should be separate (not combined in Promise.all,
    // since firing multiple keystore actions is not possible
    // (the #wrapKeystoreAction listens for the first one to finish and
    // skips the parallel one, if one is requested).
    await this.keystore.addKeys(this.accountPicker.readyToAddKeys.internal)
    await this.keystore.addKeysExternallyStored(this.accountPicker.readyToAddKeys.external)
  }

  initSignAccOp(actionId: AccountOpAction['id']): null | void {
    const accountOp = getAccountOpFromAction(actionId, this.requests.actions.actionsQueue)
    if (!accountOp) {
      this.signAccOpInitError =
        'We cannot initiate the signing process because no transaction has been found for the specified account and network.'
      return null
    }

    const network = this.networks.networks.find((n) => n.chainId === accountOp.chainId)

    if (
      !this.selectedAccount.account ||
      this.selectedAccount.account.addr !== accountOp.accountAddr
    ) {
      this.signAccOpInitError =
        'Attempting to initialize an accountOp for an account other than the currently selected one.'
      return null
    }

    if (!network) {
      this.signAccOpInitError =
        'We cannot initiate the signing process as we are unable to locate the specified network.'
      return null
    }

    // on init, set the accountOp nonce to the latest one we know
    // it could happen that the user inits a userRequest with an old
    // accountState and therefore caching the old nonce in the accountOp.
    // we make sure the latest nonce is set when initing signAccountOp
    const state =
      this.accounts.accountStates?.[accountOp.accountAddr]?.[accountOp.chainId.toString()]
    if (state) accountOp.nonce = state.nonce

    this.signAccOpInitError = null

    // if there's no signAccountOp OR
    // there is but there's a new actionId requested, rebuild it
    if (!this.signAccountOp || this.signAccountOp.fromActionId !== actionId) {
      this.destroySignAccOp()
      this.signAccountOp = new SignAccountOpController({
        callRelayer: this.callRelayer,
        accounts: this.accounts,
        networks: this.networks,
        keystore: this.keystore,
        portfolio: this.portfolio,
        externalSignerControllers: this.#externalSignerControllers,
        activity: this.activity,
        account: this.selectedAccount.account,
        network,
        provider: this.providers.providers[network.chainId.toString()],
        fromActionId: actionId,
        accountOp,
        isSignRequestStillActive: () => {
          return this.isSignRequestStillActive
        },
        shouldSimulate: true,
        shouldReestimate: true,
        onAccountOpUpdate: (updatedAccountOp: AccountOp) => {
          this.requests.actions.updateAccountOpAction(updatedAccountOp)
        },
        traceCall: (ctrl: ISignAccountOpController) => {
          this.traceCall(ctrl)
        },
        onBroadcastSuccess: this.#handleBroadcastSuccess.bind(this),
        onBroadcastFailed: this.#handleBroadcastFailed.bind(this)
      })
    }

    this.forceEmitUpdate()
  }

  async #handleBroadcastSuccess(
    submittedAccountOp: SubmittedAccountOp,
    accountOp: AccountOp,
    signAccountOpType: SignAccountOpType,
    fromActionId: string | number
  ) {
    // add the txnIds from each transaction to each Call from the accountOp
    // if identifiedBy is MultipleTxns
    const isBasicAccountBroadcastingMultiple =
      submittedAccountOp.identifiedBy.type === 'MultipleTxns'
    if (isBasicAccountBroadcastingMultiple) {
      const txnIds = submittedAccountOp.identifiedBy.identifier.split('-')
      const calls = submittedAccountOp.calls
        .map((oneCall, i) => {
          const localCall = { ...oneCall }

          // we're cutting off calls the user didn't sign / weren't broadcast
          if (!(i in txnIds)) return null

          localCall.txnId = txnIds[i] as Hex
          localCall.status = AccountOpStatus.BroadcastedButNotConfirmed
          return localCall
        })
        .filter((aCall) => aCall !== null) as Call[]
      // eslint-disable-next-line no-param-reassign
      submittedAccountOp.calls = calls

      // Handle the calls that weren't signed
      const rejectedCalls = accountOp.calls.filter((call) =>
        submittedAccountOp.calls.every((c) => c.id !== call.id)
      )
      const rejectedSwapActiveRouteIds = rejectedCalls.map((call) => {
        const userRequest = this.requests.userRequests.find((r) => r.id === call.fromUserRequestId)

        return userRequest?.meta.activeRouteId
      })

      rejectedSwapActiveRouteIds.forEach((routeId) => {
        this.removeActiveRoute(routeId)
      })

      if (rejectedCalls.length) {
        // remove the user requests that were rejected
        await this.requests.rejectUserRequests(
          'Transaction rejected by the bundler',
          rejectedCalls
            .filter((call) => !!call.fromUserRequestId)
            .map((call) => call.fromUserRequestId as string)
        )
      }
    }

    if (accountOp.meta?.swapTxn) {
      this.swapAndBridge.addActiveRoute({
        userTxIndex: accountOp.meta?.swapTxn.userTxIndex
      })
    }

    this.swapAndBridge.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(submittedAccountOp)
    await this.activity.addAccountOp(submittedAccountOp)

    // resolve dapp requests, open benzin and etc only if the main sign accountOp
    if (signAccountOpType === 'default') {
      await this.resolveAccountOpAction(submittedAccountOp, fromActionId)

      // TODO: the form should be reset in a success state in FE
      this.transactionManager?.formState.resetForm()
    }
    // TODO<Bobby>: make a new SwapAndBridgeFormStatus "Broadcast" and
    // visualize the success page on the FE instead of resetting the form
    if (signAccountOpType === 'one-click-swap-and-bridge') {
      this.swapAndBridge.resetForm()
    }

    if (signAccountOpType === 'one-click-transfer') {
      if (this.transfer.shouldTrackLatestBroadcastedAccountOp) {
        this.transfer.latestBroadcastedToken = this.transfer.selectedToken
        this.transfer.latestBroadcastedAccountOp = submittedAccountOp
      }

      this.transfer.resetForm()
    }

    await this.ui.notification.create({
      title:
        // different count can happen only on isBasicAccountBroadcastingMultiple
        submittedAccountOp.calls.length === accountOp.calls.length
          ? 'Done!'
          : 'Partially submitted',
      message: `${
        isBasicAccountBroadcastingMultiple
          ? `${submittedAccountOp.calls.length}/${accountOp.calls.length} transactions were`
          : 'The transaction was'
      } successfully signed and broadcast to the network.`
    })
  }

  async #handleBroadcastFailed(op: AccountOp) {
    // remove the active route on broadcast failure
    if (op.meta?.swapTxn) this.swapAndBridge.removeActiveRoute(op.meta.swapTxn.activeRouteId)
  }

  async handleSignAndBroadcastAccountOp(type: SignAccountOpType) {
    let signAccountOp: ISignAccountOpController | null

    if (type === 'one-click-swap-and-bridge') {
      signAccountOp = this.swapAndBridge.signAccountOpController
    } else if (type === 'one-click-transfer') {
      signAccountOp = this.transfer.signAccountOpController
    } else {
      signAccountOp = this.signAccountOp
    }

    if (!signAccountOp) {
      return this.emitError({
        level: 'major',
        message:
          'Internal error: The signing process was not initialized as expected. Please try again later or contact Ambire support if the issue persists.',
        error: new Error(
          'Error: signAccountOp controller not initialized while trying to sign and broadcast'
        )
      })
    }

    if (
      signAccountOp.isSignAndBroadcastInProgress ||
      this.statuses.signAndBroadcastAccountOp !== 'INITIAL'
    ) {
      return this.emitError({
        level: 'major',
        message: 'Please wait while the current transaction is being processed.',
        error: new Error(
          `The signing/broadcasting process is already in progress. (handleSignAndBroadcastAccountOp). Status: ${this.statuses.signAndBroadcastAccountOp}. Signing key: ${this.signAccountOp?.accountOp.signingKeyType}. Fee payer key: ${this.signAccountOp?.accountOp.gasFeePayment?.paidByKeyType}. Type: ${type}.`
        )
      })
    }

    this.statuses.signAndBroadcastAccountOp = 'LOADING'
    this.forceEmitUpdate()

    await signAccountOp
      .signAndBroadcast()
      .then(async () => {
        this.statuses.signAndBroadcastAccountOp = 'SUCCESS'
        await this.forceEmitUpdate()
      })
      .catch(async () => {
        this.statuses.signAndBroadcastAccountOp = 'ERROR'
        await this.forceEmitUpdate()
      })
      .finally(async () => {
        this.statuses.signAndBroadcastAccountOp = 'INITIAL'
        await this.forceEmitUpdate()
      })
  }

  async resolveDappBroadcast(
    submittedAccountOp: SubmittedAccountOp,
    dappHandlers: {
      promise: {
        session: { name: string; origin: string; icon: string }
        resolve: (data: any) => void
        reject: (data: any) => void
      }
      txnId?: string
    }[]
  ) {
    // No need to fetch the transaction id when there are no dapp handlers
    if (!dappHandlers.length) return

    // this could take a while
    // return the txnId to the dapp once it's confirmed as return a txId
    // that could be front ran would cause bad UX on the dapp side
    const txnId = await this.activity.getConfirmedTxId(submittedAccountOp)
    dappHandlers.forEach((handler) => {
      if (txnId) {
        // If the call has a txnId, resolve the promise with it.
        // This could happen when an EOA account is broadcasting multiple transactions.
        handler.promise.resolve({ hash: handler.txnId || txnId })
      } else {
        handler.promise.reject(
          ethErrors.rpc.transactionRejected({
            message: 'Transaction rejected by the bundler'
          })
        )
      }
    })

    this.emitUpdate()
  }

  #abortHWTransactionSign(signAccountOp: ISignAccountOpController) {
    if (!signAccountOp) return

    const paidByKeyType = this.signAccountOp?.accountOp.gasFeePayment?.paidByKeyType
    const uniqueSigningKeys = [...new Set([signAccountOp.accountOp.signingKeyType, paidByKeyType])]

    // Call the cleanup method for each unique signing key type
    uniqueSigningKeys.forEach((keyType) => {
      if (!keyType || keyType === 'internal') return

      this.#externalSignerControllers[keyType]?.signingCleanup?.()
    })
  }

  destroySignAccOp() {
    if (!this.signAccountOp) return

    this.#abortHWTransactionSign(this.signAccountOp)
    this.signAccountOp.reset()
    this.signAccountOp = null
    this.signAccOpInitError = null

    // NOTE: no need to update the portfolio here as an update is
    // fired upon removeUserRequest

    this.emitUpdate()
  }

  async traceCall(signAccountOpCtrl: ISignAccountOpController) {
    const accountOp = signAccountOpCtrl.accountOp
    if (!accountOp) return

    const network = this.networks.networks.find((n) => n.chainId === accountOp.chainId)
    if (!network) return

    const account = this.accounts.accounts.find((acc) => acc.addr === accountOp.accountAddr)
    if (!account) return

    // `traceCall` should not be invoked too frequently. However, if there is a pending timeout,
    // it should be cleared to prevent the previous interval from changing the status
    // to `SlowPendingResponse` for the newer `traceCall` invocation.
    if (this.#traceCallTimeoutId) clearTimeout(this.#traceCallTimeoutId)

    // Here, we also check the status because, in the case of re-estimation,
    // `traceCallDiscoveryStatus` is already set, and we don’t want to reset it to "InProgress".
    // This prevents the BalanceDecrease banner from flickering.
    if (signAccountOpCtrl.traceCallDiscoveryStatus === TraceCallDiscoveryStatus.NotStarted)
      signAccountOpCtrl.setDiscoveryStatus(TraceCallDiscoveryStatus.InProgress)

    // Flag the discovery logic as `SlowPendingResponse` if the call does not resolve within 2 seconds.
    const timeoutId = setTimeout(() => {
      signAccountOpCtrl.setDiscoveryStatus(TraceCallDiscoveryStatus.SlowPendingResponse)
      signAccountOpCtrl.calculateWarnings()
    }, 2000)

    this.#traceCallTimeoutId = timeoutId

    try {
      const state = this.accounts.accountStates[accountOp.accountAddr][accountOp.chainId.toString()]
      const provider = this.providers.providers[network.chainId.toString()]
      const stateOverride =
        accountOp.calls.length > 1 && isBasicAccount(account, state)
          ? {
              [account.addr]: {
                code: AmbireAccount7702.binRuntime
              }
            }
          : undefined
      const { tokens, nfts } = await debugTraceCall(
        account,
        accountOp,
        provider,
        state,
        !network.rpcNoStateOverride,
        stateOverride
      )
      const learnedNewTokens = this.portfolio.addTokensToBeLearned(tokens, network.chainId)
      const learnedNewNfts = this.portfolio.addErc721sToBeLearned(
        nfts,
        account.addr,
        network.chainId
      )
      const accountOpsForSimulation = getAccountOpsForSimulation(
        account,
        this.requests.actions.visibleActionsQueue,
        this.networks.networks
      )

      // update the portfolio only if new tokens were found through tracing
      const canUpdateSignAccountOp = !signAccountOpCtrl || signAccountOpCtrl.canUpdate()
      if (canUpdateSignAccountOp && (learnedNewTokens || learnedNewNfts)) {
        await this.portfolio.updateSelectedAccount(
          accountOp.accountAddr,
          [network],
          accountOpsForSimulation
            ? {
                accountOps: accountOpsForSimulation,
                states: await this.accounts.getOrFetchAccountStates(account.addr)
              }
            : undefined
        )
      }

      signAccountOpCtrl.setDiscoveryStatus(TraceCallDiscoveryStatus.Done)
    } catch (e: any) {
      signAccountOpCtrl.setDiscoveryStatus(TraceCallDiscoveryStatus.Failed)

      this.emitError({
        level: 'silent',
        message: 'Error in main.traceCall',
        error: e
      })
    }

    signAccountOpCtrl?.calculateWarnings()
    this.#traceCallTimeoutId = null
    clearTimeout(timeoutId)
  }

  async handleSignMessage() {
    const accountAddr = this.signMessage.messageToSign?.accountAddr
    const chainId = this.signMessage.messageToSign?.chainId

    // Could (rarely) happen if not even a single account state is fetched yet
    const shouldForceUpdateAndWaitForAccountState =
      accountAddr && chainId && !this.accounts.accountStates?.[accountAddr]?.[chainId.toString()]
    if (shouldForceUpdateAndWaitForAccountState)
      await this.accounts.updateAccountState(accountAddr, 'latest', [chainId])

    const isAccountStateStillMissing =
      !accountAddr || !chainId || !this.accounts.accountStates?.[accountAddr]?.[chainId.toString()]
    if (isAccountStateStillMissing) {
      const message =
        'Unable to sign the message. During the preparation step, required account data failed to get received. Please try again later or contact Ambire support.'
      const error = new Error(
        `The account state of ${accountAddr} is missing for the network with id ${chainId}.`
      )
      return this.emitError({ level: 'major', message, error })
    }

    await this.signMessage.sign()

    const signedMessage = this.signMessage.signedMessage
    // Error handling on the prev step will notify the user, it's fine to return here
    if (!signedMessage) return

    await this.activity.addSignedMessage(signedMessage, signedMessage.accountAddr)

    await this.requests.resolveUserRequest(
      { hash: signedMessage.signature },
      signedMessage.fromActionId
    )

    await this.ui.notification.create({
      title: 'Done!',
      message: 'The Message was successfully signed.'
    })
  }

  async #handleAccountPickerInitLedger(
    LedgerKeyIterator: any // TODO: KeyIterator type mismatch
  ) {
    try {
      const ledgerCtrl = this.#externalSignerControllers.ledger
      if (!ledgerCtrl) {
        const message =
          'Could not initialize connection with your Ledger device. Please try again later or contact Ambire support.'
        throw new EmittableError({ message, level: 'major', error: new Error(message) })
      }

      // Once a session with the Ledger device gets initiated, the user might
      // use the device with another app. In this scenario, when coming back to
      // Ambire (the second time a connection gets requested onwards),
      // the Ledger device throws with "invalid channel" error.
      // To overcome this, always make sure to clean up before starting
      // a new session when retrieving keys, in case there already is one.
      if (ledgerCtrl.walletSDK) await ledgerCtrl.cleanUp()

      const hdPathTemplate = BIP44_LEDGER_DERIVATION_TEMPLATE
      const pathToUnlock = getHdPathFromTemplate(hdPathTemplate, 0)
      await ledgerCtrl.unlock(pathToUnlock)

      if (!ledgerCtrl.walletSDK) {
        const message = 'Could not establish connection with the Ledger device'
        throw new EmittableError({ message, level: 'major', error: new Error(message) })
      }

      const keyIterator = new LedgerKeyIterator({ controller: ledgerCtrl })
      this.accountPicker.setInitParams({
        keyIterator,
        hdPathTemplate,
        pageSize: 5,
        shouldAddNextAccountAutomatically: false
      })
    } catch (error: any) {
      const message = error?.message || 'Could not unlock the Ledger device. Please try again.'
      throw new EmittableError({ message, level: 'major', error })
    }
  }

  async handleAccountPickerInitLedger(
    LedgerKeyIterator: any /* TODO: KeyIterator type mismatch */
  ) {
    await this.withStatus('handleAccountPickerInitLedger', async () =>
      this.#handleAccountPickerInitLedger(LedgerKeyIterator)
    )
  }

  async #handleAccountPickerInitTrezor(
    TrezorKeyIterator: any /* TODO: KeyIterator type mismatch */
  ) {
    try {
      const trezorCtrl = this.#externalSignerControllers.trezor

      if (!trezorCtrl) {
        const message =
          'Could not initialize connection with your Trezor device. Please try again later or contact Ambire support.'
        throw new EmittableError({ message, level: 'major', error: new Error(message) })
      }

      const hdPathTemplate = BIP44_STANDARD_DERIVATION_TEMPLATE
      const { walletSDK } = trezorCtrl
      await this.accountPicker.setInitParams({
        keyIterator: new TrezorKeyIterator({ walletSDK }),
        hdPathTemplate,
        pageSize: 5,
        shouldAddNextAccountAutomatically: false
      })
    } catch (error: any) {
      const message = error?.message || 'Could not unlock the Trezor device. Please try again.'
      throw new EmittableError({ message, level: 'major', error })
    }
  }

  async handleAccountPickerInitTrezor(
    TrezorKeyIterator: any /* TODO: KeyIterator type mismatch */
  ) {
    await this.withStatus('handleAccountPickerInitTrezor', async () =>
      this.#handleAccountPickerInitTrezor(TrezorKeyIterator)
    )
  }

  async #handleAccountPickerInitLattice(
    LatticeKeyIterator: any /* TODO: KeyIterator type mismatch */
  ) {
    try {
      const latticeCtrl = this.#externalSignerControllers.lattice
      if (!latticeCtrl) {
        const message =
          'Could not initialize connection with your Lattice1 device. Please try again later or contact Ambire support.'
        throw new EmittableError({ message, level: 'major', error: new Error(message) })
      }

      const hdPathTemplate = BIP44_STANDARD_DERIVATION_TEMPLATE

      await this.accountPicker.setInitParams({
        keyIterator: new LatticeKeyIterator({ controller: latticeCtrl }),
        hdPathTemplate,
        pageSize: 5,
        shouldAddNextAccountAutomatically: false
      })
    } catch (error: any) {
      const message = error?.message || 'Could not unlock the Lattice1 device. Please try again.'
      throw new EmittableError({ message, level: 'major', error })
    }
  }

  async handleAccountPickerInitLattice(
    LatticeKeyIterator: any /* TODO: KeyIterator type mismatch */
  ) {
    await this.withStatus('handleAccountPickerInitLattice', async () =>
      this.#handleAccountPickerInitLattice(LatticeKeyIterator)
    )
  }

  async updateAccountsOpsStatuses(): Promise<{ newestOpTimestamp: number }> {
    await this.initialLoadPromise

    const { shouldEmitUpdate, chainsToUpdate, updatedAccountsOps, newestOpTimestamp } =
      await this.activity.updateAccountsOpsStatuses()

    if (shouldEmitUpdate) {
      this.emitUpdate()

      if (chainsToUpdate.length) {
        const networks = chainsToUpdate
          ? this.networks.networks.filter((n) => chainsToUpdate.includes(n.chainId))
          : undefined

        this.updateSelectedAccountPortfolio({ networks })
      }
    }

    updatedAccountsOps.forEach((op) => {
      this.swapAndBridge.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(op)
    })

    return { newestOpTimestamp }
  }

  // call this function after a call to the singleton has been made
  // it will check if the factory has been deployed and update the network settings if it has been
  async setContractsDeployedToTrueIfDeployed(network: Network) {
    await this.initialLoadPromise
    if (network.areContractsDeployed) return

    const provider = this.providers.providers[network.chainId.toString()]
    if (!provider) return

    const factoryCode = await provider.getCode(AMBIRE_ACCOUNT_FACTORY)
    if (factoryCode === '0x') return
    await this.networks.updateNetwork({ areContractsDeployed: true }, network.chainId)
  }

  #removeAccountKeyData(address: Account['addr']) {
    // Compute account keys that are only associated with this account
    const accountAssociatedKeys =
      this.accounts.accounts.find((acc) => acc.addr === address)?.associatedKeys || []
    const keysInKeystore = this.keystore.keys
    const importedAccountKeys = keysInKeystore.filter((key) =>
      accountAssociatedKeys.includes(key.addr)
    )
    const solelyAccountKeys = importedAccountKeys.filter((key) => {
      const isKeyAssociatedWithOtherAccounts = this.accounts.accounts.some(
        (acc) => acc.addr !== address && acc.associatedKeys.includes(key.addr)
      )

      return !isKeyAssociatedWithOtherAccounts
    })

    // Remove account keys from the keystore
    solelyAccountKeys.forEach((key) => {
      this.keystore.removeKey(key.addr, key.type).catch((e) => {
        throw new EmittableError({
          level: 'major',
          message: 'Failed to remove account key',
          error: e
        })
      })
    })
  }

  async #removeAccount(address: Account['addr']) {
    try {
      this.#removeAccountKeyData(address)
      // Remove account data from sub-controllers
      this.accounts.removeAccountData(address)
      this.portfolio.removeAccountData(address)
      await this.activity.removeAccountData(address)
      this.requests.actions.removeAccountData(address)
      this.signMessage.removeAccountData(address)
      this.defiPositions.removeAccountData(address)

      if (this.selectedAccount.account?.addr === address) {
        await this.#selectAccount(this.accounts.accounts[0]?.addr)
      }

      if (this.signAccountOp?.account.addr === address) {
        this.destroySignAccOp()
      }

      this.emitUpdate()
    } catch (e: any) {
      throw new EmittableError({
        level: 'major',
        message: 'Failed to remove account',
        error: e || new Error('Failed to remove account')
      })
    }
  }

  async removeAccount(address: Account['addr']) {
    await this.withStatus('removeAccount', async () => this.#removeAccount(address))
  }

  async reloadSelectedAccount(options?: {
    chainIds?: bigint[]
    resetSelectedAccountPortfolio?: boolean
    maxDataAgeMs?: number
    isManualReload?: boolean
  }) {
    const {
      chainIds,
      isManualReload = false,
      maxDataAgeMs,
      resetSelectedAccountPortfolio = true
    } = options || {}
    const networksToUpdate = chainIds
      ? this.networks.networks.filter((n) => chainIds.includes(n.chainId))
      : undefined
    if (!this.selectedAccount.account) return

    if (resetSelectedAccountPortfolio) this.selectedAccount.resetSelectedAccountPortfolio()

    await Promise.all([
      // When we trigger `reloadSelectedAccount` (for instance, from Dashboard -> Refresh balance icon),
      // it's very likely that the account state is already in the process of being updated.
      // If we try to run the same action, `withStatus` validation will throw an error.
      // So, we perform this safety check to prevent the error.
      // However, even if we don't trigger an update here, it's not a big problem,
      // as the account state will be updated anyway, and its update will be very recent.
      !this.accounts.areAccountStatesLoading && this.selectedAccount.account?.addr
        ? this.accounts.updateAccountState(this.selectedAccount.account.addr, 'pending', chainIds)
        : Promise.resolve(),
      // `updateSelectedAccountPortfolio` doesn't rely on `withStatus` validation internally,
      // as the PortfolioController already exposes flags that are highly sufficient for the UX.
      // Additionally, if we trigger the portfolio update twice (i.e., running a long-living interval + force update from the Dashboard),
      // there won't be any error thrown, as all portfolio updates are queued and they don't use the `withStatus` helper.
      this.updateSelectedAccountPortfolio({
        networks: networksToUpdate,
        isManualUpdate: isManualReload,
        maxDataAgeMs
      }),
      this.defiPositions.updatePositions({ chainIds, maxDataAgeMs, forceUpdate: isManualReload })
    ])
  }

  #updateIsOffline() {
    const oldIsOffline = this.isOffline
    const accountAddr = this.selectedAccount.account?.addr

    if (!accountAddr) return

    // We have to make calculations based on the state of the portfolio
    // and not the selected account portfolio the flag isOffline
    // and the errors of the selected account portfolio should
    // come in the same tick. Otherwise the UI may flash the wrong error.
    const latestState = this.portfolio.getLatestPortfolioState(accountAddr)
    const latestStateKeys = Object.keys(latestState)
    const isAllLoaded = latestStateKeys.every((chainId) => {
      return isNetworkReady(latestState[chainId]) && !latestState[chainId]?.isLoading
    })

    // Set isOffline back to false if the portfolio is loading.
    // This is done to prevent the UI from flashing the offline error
    if (!latestStateKeys.length || !isAllLoaded) {
      // Skip unnecessary updates
      if (!this.isOffline) return

      this.isOffline = false
      this.emitUpdate()
      return
    }

    const allPortfolioNetworksHaveErrors = latestStateKeys.every((chainId) => {
      const state = latestState[chainId]

      return !!state?.criticalError
    })

    const allNetworkRpcsAreDown = Object.keys(this.providers.providers).every((chainId) => {
      const provider = this.providers.providers[chainId]
      const isWorking = provider.isWorking

      return typeof isWorking === 'boolean' && !isWorking
    })

    // Update isOffline if either all portfolio networks have errors or we've failed to fetch
    // the account state for every account. This is because either update may fail first.
    this.isOffline = !!allNetworkRpcsAreDown || !!allPortfolioNetworksHaveErrors

    if (oldIsOffline !== this.isOffline) {
      this.emitUpdate()
    }
  }

  async updateSelectedAccountPortfolio(opts?: {
    networks?: Network[]
    isManualUpdate?: boolean
    maxDataAgeMs?: number
  }) {
    const { networks, maxDataAgeMs, isManualUpdate } = opts || {}

    await this.initialLoadPromise
    if (!this.selectedAccount.account) return
    const canUpdateSignAccountOp = !this.signAccountOp || this.signAccountOp.canUpdate()
    if (!canUpdateSignAccountOp) return

    const accountOpsToBeSimulatedByNetwork = getAccountOpsForSimulation(
      this.selectedAccount.account,
      this.requests.actions.visibleActionsQueue,
      this.networks.networks
    )

    await this.portfolio.updateSelectedAccount(
      this.selectedAccount.account.addr,
      networks,
      accountOpsToBeSimulatedByNetwork
        ? {
            accountOps: accountOpsToBeSimulatedByNetwork,
            states: await this.accounts.getOrFetchAccountStates(this.selectedAccount.account.addr)
          }
        : undefined,
      { maxDataAgeMs, isManualUpdate }
    )
    this.#updateIsOffline()
  }

  async rejectSignAccountOpCall(callId: string) {
    if (!this.signAccountOp) return

    const { calls, chainId, accountAddr } = this.signAccountOp.accountOp

    const requestId = calls.find((c) => c.id === callId)?.fromUserRequestId
    if (requestId) {
      const userRequestIndex = this.requests.userRequests.findIndex((r) => r.id === requestId)
      const userRequest = this.requests.userRequests[userRequestIndex] as SignUserRequest
      if (userRequest.action.kind === 'calls') {
        ;(userRequest.action as Calls).calls = (userRequest.action as Calls).calls.filter(
          (c) => c.id !== callId
        )

        if (userRequest.action.calls.length === 0) {
          // the reject will remove the userRequest which will rebuild the action and update the signAccountOp
          await this.requests.rejectUserRequests('User rejected the transaction request.', [
            userRequest.id
          ])
        } else {
          const accountOpAction = makeAccountOpAction({
            account: this.accounts.accounts.find((a) => a.addr === accountAddr)!,
            chainId,
            nonce: this.accounts.accountStates[accountAddr][chainId.toString()].nonce,
            userRequests: this.requests.userRequests,
            actionsQueue: this.requests.actions.actionsQueue
          })

          await this.requests.actions.addOrUpdateActions([accountOpAction], {
            skipFocus: true
          })
          this.signAccountOp?.update({ accountOpData: { calls: accountOpAction.accountOp.calls } })
        }
      }
    } else {
      this.emitError({
        message: 'Reject call: the call was not found or was not linked to a user request',
        level: 'major',
        error: new Error(
          `Error: rejectAccountOpCall: userRequest for call with id ${callId} was not found`
        )
      })
    }
  }

  async removeActiveRoute(activeRouteId: SwapAndBridgeActiveRoute['activeRouteId']) {
    const userRequest = this.requests.userRequests.find((r) =>
      [activeRouteId, `${activeRouteId}-approval`, `${activeRouteId}-revoke-approval`].includes(
        r.id as string
      )
    )

    if (userRequest) {
      await this.requests.rejectUserRequests('User rejected the transaction request.', [
        userRequest.id
      ])
    } else {
      this.swapAndBridge.removeActiveRoute(activeRouteId)
    }
  }

  async addNetwork(network: AddNetworkRequestParams) {
    await this.networks.addNetwork(network)

    const networkToUpdate = this.networks.networks.find((n) => n.chainId === network.chainId)

    await this.updateSelectedAccountPortfolio({
      networks: networkToUpdate ? [networkToUpdate] : undefined
    })
  }

  removeNetworkData(chainId: bigint) {
    this.portfolio.removeNetworkData(chainId)
    this.accountPicker.removeNetworkData(chainId)
    // Don't remove user activity for now because removing networks
    // is no longer possible in the UI. Users can only disable networks
    // and it doesn't make sense to delete their activity
    // this.activity.removeNetworkData(chainId)

    // Don't remove the defi positions state data because we keep track of the defi positions
    // on the disabled networks so we can suggest enabling them from a dashboard banner
    // this.defiPositions.removeNetworkData(chainId)
  }

  async resolveAccountOpAction(
    submittedAccountOp: SubmittedAccountOp,
    actionId: AccountOpAction['id']
  ) {
    const accountOpAction = this.requests.actions.actionsQueue.find((a) => a.id === actionId)
    if (!accountOpAction) return

    const { accountOp } = accountOpAction as AccountOpAction
    const network = this.networks.networks.find((n) => n.chainId === accountOp.chainId)

    if (!network) return

    const calls: Call[] = submittedAccountOp.calls
    const meta: SignUserRequest['meta'] = {
      isSignAction: true,
      accountAddr: accountOp.accountAddr,
      chainId: network.chainId,
      txnId: null,
      userOpHash: null
    }

    if (submittedAccountOp) {
      // can be undefined, check submittedAccountOp.ts
      meta.txnId = submittedAccountOp.txnId
      meta.identifiedBy = submittedAccountOp.identifiedBy
      meta.submittedAccountOp = submittedAccountOp
    }

    const benzinUserRequest: SignUserRequest = {
      id: new Date().getTime(),
      action: { kind: 'benzin' },
      session: new Session(),
      meta
    }
    await this.requests.addUserRequests([benzinUserRequest], {
      actionPosition: 'first',
      skipFocus: true
    })

    await this.requests.actions.removeActions([actionId])

    const userRequestsToRemove: UserRequest['id'][] = []
    const dappHandlers: any[] = []

    // handle wallet_sendCalls before activity.getConfirmedTxId as 1) it's faster
    // 2) the identifier is different
    calls.forEach((call) => {
      const walletSendCallsUserReq = this.requests.userRequests.find(
        (r) => r.id === call.fromUserRequestId && r.meta.isWalletSendCalls
      )
      const uReq = this.requests.userRequests.find((r) => r.id === call.fromUserRequestId)

      if (walletSendCallsUserReq) {
        walletSendCallsUserReq.dappPromise?.resolve({
          hash: getDappIdentifier(submittedAccountOp)
        })

        userRequestsToRemove.push(walletSendCallsUserReq.id)
      }

      if (uReq) {
        if (uReq.dappPromise) {
          dappHandlers.push({
            promise: uReq.dappPromise,
            txnId: call.txnId
          })
        }

        userRequestsToRemove.push(uReq.id)
      }
    })

    await this.requests.removeUserRequests(userRequestsToRemove, {
      shouldRemoveSwapAndBridgeRoute: false,
      // Since `resolveAccountOpAction` is invoked only when we broadcast a transaction,
      // we don't want to update the account portfolio immediately, as we would lose the simulation.
      // The simulation is required to calculate the pending badges (see: calculatePendingAmounts()).
      // Once the transaction is confirmed, delayed, or the user manually refreshes the portfolio,
      // the account will be updated automatically.
      shouldUpdateAccount: false
    })

    this.resolveDappBroadcast(submittedAccountOp, dappHandlers)

    this.emitUpdate()
  }

  async rejectAccountOpAction(
    err: string,
    actionId: AccountOpAction['id'],
    shouldOpenNextAction: boolean
  ) {
    const accountOpAction = this.requests.actions.actionsQueue.find((a) => a.id === actionId)
    if (!accountOpAction) return

    const { accountOp, id } = accountOpAction as AccountOpAction

    if (this.signAccountOp && this.signAccountOp.fromActionId === id) {
      this.destroySignAccOp()
    }
    await this.requests.actions.removeActions([actionId], shouldOpenNextAction)

    const requestIdsToRemove = accountOp.calls
      .filter((call) => !!call.fromUserRequestId)
      .map((call) => call.fromUserRequestId)

    await this.requests.rejectUserRequests(err, requestIdsToRemove as string[], {
      shouldOpenNextRequest: shouldOpenNextAction
    })

    this.emitUpdate()
  }

  onOneClickSwapClose() {
    const signAccountOp = this.swapAndBridge.signAccountOpController

    // Always unload the screen when the action window is closed
    this.swapAndBridge.unloadScreen('action-window', true)

    if (!signAccountOp) return

    // Remove the active route if it exists
    if (signAccountOp.accountOp.meta?.swapTxn) {
      this.swapAndBridge.removeActiveRoute(signAccountOp.accountOp.meta.swapTxn.activeRouteId)
    }

    this.#abortHWTransactionSign(signAccountOp)

    const network = this.networks.networks.find(
      (n) => n.chainId === signAccountOp.accountOp.chainId
    )

    this.updateSelectedAccountPortfolio({
      networks: network ? [network] : undefined
    })
    this.emitUpdate()
  }

  onOneClickTransferClose() {
    const signAccountOp = this.transfer.signAccountOpController

    // Always unload the screen when the action window is closed
    this.transfer.unloadScreen(true)

    if (!signAccountOp) return

    this.#abortHWTransactionSign(signAccountOp)

    const network = this.networks.networks.find(
      (n) => n.chainId === signAccountOp.accountOp.chainId
    )

    this.updateSelectedAccountPortfolio({
      networks: network ? [network] : undefined
    })
    this.emitUpdate()
  }

  get isSignRequestStillActive(): boolean {
    if (!this.signAccountOp) return false

    return !!this.requests.actions.actionsQueue.find(
      (a) => a.id === this.signAccountOp!.fromActionId
    )
  }

  /**
   * Don't allow the user to open new action windows
   * if there's a pending to sign action (swap and bridge or transfer)
   * with a hardware wallet (аpplies to Trezor only, since it doesn't work in a pop-up and must be opened in an action window).
   * This is done to prevent complications with the signing process- e.g. a new request
   * being sent to the hardware wallet while the swap and bridge (or transfer) is still pending.
   * @returns {boolean} - true if an error was thrown
   * @throws {Error} - if throwRpcError is true
   */
  async #guardHWSigning(throwRpcError = false): Promise<boolean> {
    const pendingAction = this.requests.actions.visibleActionsQueue.find(
      ({ type }) => type === 'swapAndBridge' || type === 'transfer'
    )

    if (!pendingAction) return false

    const isSigningOrBroadcasting = this.statuses.signAndBroadcastAccountOp === 'LOADING'

    // The swap and bridge or transfer is done/forgotten so we can remove the action
    if (!isSigningOrBroadcasting) {
      await this.requests.actions.removeActions([pendingAction.id])

      if (pendingAction.type === 'swapAndBridge') {
        this.swapAndBridge.reset()
      } else {
        this.transfer.resetForm()
      }

      return false
    }

    const errors = {
      swapAndBridge: {
        message: 'Please complete the pending swap action.',
        error: 'Pending swap action',
        rpcError: 'You have a pending swap action. Please complete it before signing.'
      },
      transfer: {
        message: 'Please complete the pending transfer action.',
        error: 'Pending transfer action',
        rpcError: 'You have a pending transfer action. Please complete it before signing.'
      }
    }

    const error = errors[pendingAction.type as keyof typeof errors]

    // Don't reopen the action window if focusing it fails
    // because closing it will abort the signing process
    await this.requests.actions.focusActionWindow({ reopenIfNeeded: false })
    this.emitError({
      level: 'expected',
      message: error.message,
      error: new Error(error.error)
    })

    if (throwRpcError) {
      throw ethErrors.rpc.transactionRejected({
        message: error.rpcError
      })
    }

    return true
  }

  // includes the getters in the stringified instance
  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      isSignRequestStillActive: this.isSignRequestStillActive
    }
  }
}
