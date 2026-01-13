/* eslint-disable @typescript-eslint/brace-style */
import { ethErrors } from 'eth-rpc-errors'

import EmittableError from '../../classes/EmittableError'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import {
  BIP44_LEDGER_DERIVATION_TEMPLATE,
  BIP44_STANDARD_DERIVATION_TEMPLATE
} from '../../consts/derivation'
import { FeatureFlags } from '../../consts/featureFlags'
import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { Account, IAccountsController } from '../../interfaces/account'
import { IAccountPickerController } from '../../interfaces/accountPicker'
import { IActivityController } from '../../interfaces/activity'
import { IAddressBookController } from '../../interfaces/addressBook'
import { IAutoLoginController } from '../../interfaces/autoLogin'
import { IBannerController } from '../../interfaces/banner'
import { IContractNamesController } from '../../interfaces/contractNames'
import { IDappsController } from '../../interfaces/dapp'
import { IDefiPositionsController } from '../../interfaces/defiPositions'
import { IDomainsController } from '../../interfaces/domains'
import { IEmailVaultController } from '../../interfaces/emailVault'
import { ErrorRef, IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
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
import { IMainController, STATUS_WRAPPED_METHODS } from '../../interfaces/main'
import { AddNetworkRequestParams, INetworksController, Network } from '../../interfaces/network'
import { IPhishingController } from '../../interfaces/phishing'
import { Platform } from '../../interfaces/platform'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { IRequestsController } from '../../interfaces/requests'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { ISignAccountOpController } from '../../interfaces/signAccountOp'
import { ISignMessageController } from '../../interfaces/signMessage'
import { IStorageController, Storage } from '../../interfaces/storage'
import { ISwapAndBridgeController, SwapAndBridgeActiveRoute } from '../../interfaces/swapAndBridge'
import { ITransactionManagerController } from '../../interfaces/transactionManager'
import { ITransferController } from '../../interfaces/transfer'
import { IUiController, UiManager, View } from '../../interfaces/ui'
import { BenzinUserRequest, CallsUserRequest } from '../../interfaces/userRequest'
import { getDefaultSelectedAccount } from '../../libs/account/account'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { getDappIdentifier, SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
/* eslint-disable no-await-in-loop */
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { getAccountOpsForSimulation } from '../../libs/main/main'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { isNetworkReady } from '../../libs/selectedAccount/selectedAccount'
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
import { AutoLoginController } from '../autoLogin/autoLogin'
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
import { OnboardingSuccessProps } from '../signAccountOp/signAccountOp'
import { SignMessageController } from '../signMessage/signMessage'
import { StorageController } from '../storage/storage'
import { SwapAndBridgeController } from '../swapAndBridge/swapAndBridge'
import { TransactionManagerController } from '../transaction/transactionManager'
import { TransferController } from '../transfer/transfer'
import { UiController } from '../ui/ui'

export class MainController extends EventEmitter implements IMainController {
  #storageAPI: Storage

  #appVersion: string

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

  signAccOpInitError: string | null = null

  activity: IActivityController

  addressBook: IAddressBookController

  domains: IDomainsController

  contractNames: IContractNamesController

  autoLogin: IAutoLoginController

  accounts: IAccountsController

  selectedAccount: ISelectedAccountController

  requests: IRequestsController

  banner: IBannerController

  accountOpsToBeConfirmed: { [key: string]: { [key: string]: AccountOp } } = {}

  lastUpdate: Date = new Date()

  isOffline: boolean = false

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  ui: IUiController

  #continuousUpdates: ContinuousUpdatesController

  get continuousUpdates() {
    return this.#continuousUpdates
  }

  constructor({
    eventEmitterRegistry,
    appVersion,
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
    eventEmitterRegistry?: IEventEmitterRegistryController
    appVersion: string
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
    super(eventEmitterRegistry)
    this.#storageAPI = storageAPI
    this.#appVersion = appVersion
    this.fetch = fetch
    this.storage = new StorageController(this.#storageAPI, eventEmitterRegistry)
    this.featureFlags = new FeatureFlagsController(featureFlags, eventEmitterRegistry)
    this.ui = new UiController({ eventEmitterRegistry, uiManager })
    this.invite = new InviteController({
      eventEmitterRegistry,
      relayerUrl,
      fetch,
      storage: this.storage
    })
    this.keystore = new KeystoreController(
      platform,
      this.storage,
      keystoreSigners,
      this.ui,
      eventEmitterRegistry
    )
    this.#externalSignerControllers = externalSignerControllers
    this.networks = new NetworksController({
      eventEmitterRegistry,
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

    this.providers = new ProvidersController(this.networks, this.storage, eventEmitterRegistry)
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
      this.#updateIsOffline.bind(this),
      relayerUrl,
      this.fetch,
      eventEmitterRegistry
    )
    this.autoLogin = new AutoLoginController(
      this.storage,
      this.keystore,
      this.providers,
      this.networks,
      this.accounts,
      this.#externalSignerControllers,
      this.invite,
      eventEmitterRegistry
    )
    this.selectedAccount = new SelectedAccountController({
      eventEmitterRegistry,
      storage: this.storage,
      accounts: this.accounts,
      keystore: this.keystore,
      autoLogin: this.autoLogin
    })
    this.banner = new BannerController(this.storage, eventEmitterRegistry)
    this.portfolio = new PortfolioController(
      this.storage,
      this.fetch,
      this.providers,
      this.networks,
      this.accounts,
      this.keystore,
      relayerUrl,
      velcroUrl,
      this.banner,
      eventEmitterRegistry
    )
    this.defiPositions = new DefiPositionsController({
      eventEmitterRegistry,
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
        this.keystore,
        undefined,
        eventEmitterRegistry
      )
    }
    this.accountPicker = new AccountPickerController({
      eventEmitterRegistry,
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
    this.addressBook = new AddressBookController(
      this.storage,
      this.accounts,
      this.selectedAccount,
      eventEmitterRegistry
    )
    this.signMessage = new SignMessageController(
      this.keystore,
      this.providers,
      this.networks,
      this.accounts,
      this.#externalSignerControllers,
      this.invite,
      eventEmitterRegistry
    )
    this.phishing = new PhishingController({
      eventEmitterRegistry,
      fetch: this.fetch,
      storage: this.storage,
      addressBook: this.addressBook
    })

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
      },
      eventEmitterRegistry
    )
    const LiFiProvider = new LiFiAPI({ fetch, apiKey: liFiApiKey })
    const SocketProvider = new SocketAPI({ fetch, apiKey: bungeeApiKey })
    this.swapAndBridge = new SwapAndBridgeController({
      eventEmitterRegistry,
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
      phishing: this.phishing,
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
      isCurrentSignAccountOpThrowingAnEstimationError: (
        fromChainId: number | null,
        toChainId: number | null
      ) => {
        const signAccountOp =
          this.requests.currentUserRequest?.kind === 'calls'
            ? this.requests.currentUserRequest.signAccountOp
            : undefined
        return (
          signAccountOp &&
          fromChainId &&
          toChainId &&
          signAccountOp.estimation.status === EstimationStatus.Error &&
          signAccountOp.accountOp.chainId === BigInt(fromChainId) &&
          fromChainId === toChainId
        )
      },
      getUserRequests: () => this.requests.userRequests || [],
      getVisibleUserRequests: () => this.requests.visibleUserRequests || [],
      onBroadcastSuccess: this.#commonHandlerForBroadcastSuccess.bind(this),
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
      this.phishing,
      relayerUrl,
      this.#commonHandlerForBroadcastSuccess.bind(this),
      this.ui,
      eventEmitterRegistry
    )
    this.domains = new DomainsController({
      eventEmitterRegistry,
      providers: this.providers.providers,
      defaultNetworksMode: this.networks.defaultNetworksMode
    })

    this.contractNames = new ContractNamesController({
      eventEmitterRegistry,
      fetch: this.fetch
    })

    if (this.featureFlags.isFeatureEnabled('withTransactionManagerController')) {
      // TODO: [WIP] - The manager should be initialized with transfer and swap and bridge controller dependencies.
      this.transactionManager = new TransactionManagerController({
        eventEmitterRegistry,
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
      eventEmitterRegistry,
      relayerUrl,
      callRelayer: this.callRelayer,
      portfolio: this.portfolio,
      externalSignerControllers: this.#externalSignerControllers,
      activity: this.activity,
      phishing: this.phishing,
      accounts: this.accounts,
      networks: this.networks,
      providers: this.providers,
      selectedAccount: this.selectedAccount,
      keystore: this.keystore,
      transfer: this.transfer,
      swapAndBridge: this.swapAndBridge,
      ui: this.ui,
      transactionManager: this.transactionManager,
      autoLogin: this.autoLogin,
      getDapp: async (id) => {
        await this.dapps.initialLoadPromise
        return this.dapps.getDapp(id)
      },
      updateSelectedAccountPortfolio: async (networks) => {
        await this.updateSelectedAccountPortfolio({ networks })
      },
      addTokensToBeLearned: this.portfolio.addTokensToBeLearned.bind(this.portfolio),
      onSetCurrentUserRequest: (currentRequest) => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.dapps.setDappToConnectIfNeeded(currentRequest)
      },
      onBroadcastSuccess: async (props) => {
        const { submittedAccountOp, fromRequestId } = props
        this.portfolio.markSimulationAsBroadcasted(
          submittedAccountOp.accountAddr,
          submittedAccountOp.chainId
        )
        await this.#commonHandlerForBroadcastSuccess(props)
        // resolve dapp requests, open benzin and etc only if the main sign accountOp
        this.resolveAccountOpRequest(submittedAccountOp, fromRequestId)
        this.transactionManager?.formState.resetForm() // TODO: the form should be reset in a success state in FE
      },
      onBroadcastFailed: this.#handleBroadcastFailed.bind(this)
    })

    this.dapps = new DappsController({
      eventEmitterRegistry,
      appVersion: this.#appVersion,
      fetch: this.fetch,
      storage: this.storage,
      networks: this.networks,
      phishing: this.phishing,
      selectedAccount: this.selectedAccount,
      ui: this.ui
    })

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })

    this.#continuousUpdates = new ContinuousUpdatesController({
      eventEmitterRegistry,
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
      if (this.requests.currentUserRequest?.kind !== 'calls') return
      this.emitError(e)
    })

    this.keystore.onUpdate(() => {
      if (this.keystore.statuses.unlockWithSecret === 'SUCCESS') {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.storage.associateAccountKeysWithLegacySavedSeedMigration(
          () =>
            new AccountPickerController({
              eventEmitterRegistry,
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
      const ONE_HOUR = 1000 * 60 * 60
      this.domains.batchReverseLookup(this.accounts.accounts.map((a) => a.addr))

      if (!(this.activity.broadcastedButNotConfirmed[selectedAccountAddr] || []).length) {
        this.updateSelectedAccountPortfolio({
          maxDataAgeMs: FIVE_MINUTES,
          maxDataAgeMsUnused: ONE_HOUR
        })
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
    await this.initialLoadPromise

    await this.withStatus('selectAccount', async () => this.#selectAccount(toAccountAddr), true)
  }

  async #selectAccount(toAccountAddr: string | null) {
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
    // call closeRequestWindow while still on the currently selected account to allow proper
    // state cleanup of the controllers like requestsCtrl, signAccountOpCtrl, signMessageCtrl...
    if (this.requests.currentUserRequest?.kind !== 'switchAccount') {
      await this.requests.closeRequestWindow()
    }
    const swapAndBridgeSigningRequest = this.requests.visibleUserRequests.find(
      ({ kind }) => kind === 'swapAndBridge'
    )
    if (swapAndBridgeSigningRequest) {
      await this.requests.removeUserRequests([swapAndBridgeSigningRequest.id])
    }
    await this.selectedAccount.setAccount(accountToSelect)
    this.#continuousUpdates.updatePortfolioInterval.restart()
    this.#continuousUpdates.accountStateLatestInterval.restart()
    this.#continuousUpdates.accountsOpsStatusesInterval.restart({ runImmediately: true })
    this.swapAndBridge.updateActiveRoutesInterval.restart({ runImmediately: true })
    this.swapAndBridge.reset()
    this.transfer.resetForm()

    // Don't await this as it's not critical for the account selection
    // and if the user decides to quickly change to another account withStatus
    // will block the UI until these are resolved.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.reloadSelectedAccount({
      maxDataAgeMs: 5 * 60 * 1000,
      maxDataAgeMsUnused: 60 * 60 * 1000
    })

    // forceEmitUpdate to update the getters in the FE state of the ctrls
    await Promise.all([
      this.activity.forceEmitUpdate(),
      this.requests.forceEmitUpdate(),
      this.addressBook.forceEmitUpdate(),
      this.swapAndBridge.forceEmitUpdate(),
      this.dapps.broadcastDappSessionEvent('accountsChanged', [toAccountAddr]),
      this.forceEmitUpdate()
    ])
  }

  async #onAccountPickerSuccess() {
    if (this.keystore.isKeyIteratorInitializedWithTempSeed(this.accountPicker.keyIterator))
      await this.keystore.persistTempSeed()

    const storedSeed = await this.keystore.getKeystoreSeed(this.accountPicker.keyIterator)
    if (storedSeed) {
      await this.keystore.updateSeed({
        id: storedSeed.id,
        hdPathTemplate: this.accountPicker.hdPathTemplate
      })

      this.accountPicker.readyToAddKeys.internal = this.accountPicker.readyToAddKeys.internal.map(
        (key) => ({ ...key, meta: { ...key.meta, fromSeedId: storedSeed.id } })
      )
    }

    // Should be separate (not combined in Promise.all, since firing multiple
    // keystore actions is not possible (the #wrapKeystoreAction listens for the
    // first one to finish and skips the parallel one, if one is requested).
    await this.keystore.addKeys(this.accountPicker.readyToAddKeys.internal)
    await this.keystore.addKeysExternallyStored(this.accountPicker.readyToAddKeys.external)

    if (this.accountPicker.readyToRemoveAccounts) {
      // eslint-disable-next-line no-restricted-syntax
      for (const acc of this.accountPicker.readyToRemoveAccounts) {
        await this.#removeAccount(acc.addr)
      }
    }

    // Add accounts as a final step, because some of the next steps check if accounts have keys.
    await this.accounts.addAccounts(this.accountPicker.readyToAddAccounts)
  }

  async #commonHandlerForBroadcastSuccess({
    submittedAccountOp,
    accountOp,
    fromRequestId
  }: OnboardingSuccessProps) {
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

      const userRequest = this.requests.userRequests.find((r) => r.id === fromRequestId)

      if (userRequest) {
        // Handle the calls that weren't signed
        const rejectedCalls = accountOp.calls.filter((call) =>
          submittedAccountOp.calls.every((c) => c.id !== call.id)
        )

        await this.requests.rejectCalls({ callIds: rejectedCalls.map((c) => c.id) })
      }
    }

    if (accountOp.meta?.swapTxn) {
      this.swapAndBridge.addActiveRoute({ userTxIndex: accountOp.meta?.swapTxn.userTxIndex })
    }

    this.swapAndBridge.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(submittedAccountOp)
    await this.activity.addAccountOp(submittedAccountOp)
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

  async handleSignAndBroadcastAccountOp(type: SignAccountOpType, fromRequestId: string | number) {
    let signAccountOp: ISignAccountOpController | null = null

    if (
      type === 'one-click-swap-and-bridge' &&
      this.swapAndBridge.signAccountOpController &&
      this.swapAndBridge.signAccountOpController.fromRequestId === fromRequestId
    ) {
      signAccountOp = this.swapAndBridge.signAccountOpController
    } else if (
      type === 'one-click-transfer' &&
      this.transfer.signAccountOpController &&
      this.transfer.signAccountOpController.fromRequestId === fromRequestId
    ) {
      signAccountOp = this.transfer.signAccountOpController
    } else if (
      this.requests.currentUserRequest?.kind === 'calls' &&
      this.requests.currentUserRequest.signAccountOp.fromRequestId === fromRequestId
    ) {
      signAccountOp = this.requests.currentUserRequest.signAccountOp
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

    let isSignAndBroadcastInProgressOnThisAccountAndChain = false

    if (
      this.requests.visibleUserRequests.some(
        (r) =>
          r.kind === 'calls' &&
          r.signAccountOp.accountOp.chainId === signAccountOp.accountOp.chainId &&
          r.signAccountOp.isSignAndBroadcastInProgress
      )
    ) {
      isSignAndBroadcastInProgressOnThisAccountAndChain = true
    } else if (
      type !== 'one-click-swap-and-bridge' &&
      this.swapAndBridge.signAccountOpController &&
      this.swapAndBridge.signAccountOpController.accountOp.accountAddr ===
        signAccountOp.accountOp.accountAddr &&
      this.swapAndBridge.signAccountOpController.accountOp.chainId ===
        signAccountOp.accountOp.chainId &&
      this.swapAndBridge.signAccountOpController.isSignAndBroadcastInProgress
    ) {
      isSignAndBroadcastInProgressOnThisAccountAndChain = true
    } else if (
      type !== 'one-click-transfer' &&
      this.transfer.signAccountOpController &&
      this.transfer.signAccountOpController.accountOp.accountAddr ===
        signAccountOp.accountOp.accountAddr &&
      this.transfer.signAccountOpController.accountOp.chainId === signAccountOp.accountOp.chainId &&
      this.transfer.signAccountOpController.isSignAndBroadcastInProgress
    ) {
      isSignAndBroadcastInProgressOnThisAccountAndChain = true
    }

    if (isSignAndBroadcastInProgressOnThisAccountAndChain) {
      return this.emitError({
        level: 'major',
        message: 'Please wait while the previous transaction is being processed.',
        error: new Error(
          `The signing/broadcasting process is already in progress. (handleSignAndBroadcastAccountOp). Signing key: ${signAccountOp?.accountOp.signingKeyType}. Fee payer key: ${signAccountOp?.accountOp.gasFeePayment?.paidByKeyType}. Type: ${type}.`
        )
      })
    }

    await signAccountOp.signAndBroadcast().catch(() => {
      // intentionally ignored - handled inside signAccountOp
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

    // The user may sign an invalid siwe message. We don't want to create policies
    // for such messages
    if (
      signedMessage.content.kind === 'siwe' &&
      signedMessage.content.parsedMessage &&
      signedMessage.content.siweValidityStatus === 'valid'
    ) {
      await this.autoLogin.onSiweMessageSigned(
        signedMessage.content.parsedMessage,
        signedMessage.content.isAutoLoginEnabledByUser,
        signedMessage.content.autoLoginDuration
      )
    }

    await this.activity.addSignedMessage(signedMessage, signedMessage.accountAddr)

    await this.requests.resolveUserRequest(
      { hash: signedMessage.signature },
      signedMessage.fromRequestId
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

    const addressesWithPendingOps = Object.entries(this.activity.broadcastedButNotConfirmed)
      .filter(([, ops]) => ops.length > 0)
      .map(([addr]) => addr)

    const updatedAccountsOpsByAccount = await this.activity.updateAccountsOpsStatuses(
      addressesWithPendingOps
    )

    Object.values(updatedAccountsOpsByAccount).forEach(
      ({ updatedAccountsOps: accUpdatedAccountsOps }) => {
        accUpdatedAccountsOps.forEach((op) => {
          this.swapAndBridge.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(op)
        })
      }
    )

    if (!this.selectedAccount.account) return { newestOpTimestamp: 0 }

    const updatedAccountsOpsForSelectedAccount = updatedAccountsOpsByAccount[
      this.selectedAccount.account.addr
    ] || {
      shouldEmitUpdate: false,
      chainsToUpdate: [],
      updatedAccountsOps: [],
      newestOpTimestamp: 0
    }
    const { shouldEmitUpdate, chainsToUpdate, newestOpTimestamp } =
      updatedAccountsOpsForSelectedAccount

    if (shouldEmitUpdate) {
      this.emitUpdate()

      if (chainsToUpdate.length) {
        const networks = chainsToUpdate
          ? this.networks.networks.filter((n) => chainsToUpdate.includes(n.chainId))
          : undefined

        if (networks?.length) {
          this.updateSelectedAccountPortfolio({ networks })

          // update the account state to latest as well
          this.accounts.updateAccountState(
            this.selectedAccount.account.addr,
            'latest',
            networks?.map((net) => net.chainId)
          )
        }
      }
    }

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
      this.requests.removeAccountData(address)
      this.signMessage.removeAccountData(address)
      this.defiPositions.removeAccountData(address)

      if (this.selectedAccount.account?.addr === address) {
        await this.#selectAccount(this.accounts.accounts[0]?.addr ?? null)
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
    maxDataAgeMs?: number
    maxDataAgeMsUnused?: number
    isManualReload?: boolean
  }) {
    const { chainIds, isManualReload = false, maxDataAgeMsUnused, maxDataAgeMs } = options || {}
    const networksToUpdate = chainIds
      ? this.networks.networks.filter((n) => chainIds.includes(n.chainId))
      : undefined
    if (!this.selectedAccount.account) return

    if (isManualReload)
      this.selectedAccount.resetSelectedAccountPortfolio({ isManualUpdate: isManualReload })

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
        maxDataAgeMsUnused,
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
    const portfolioState = this.portfolio.getAccountPortfolioState(accountAddr)
    const portfolioStateKeys = Object.keys(portfolioState)
    const isAllLoaded = portfolioStateKeys.every((chainId) => {
      return isNetworkReady(portfolioState[chainId]) && !portfolioState[chainId]?.isLoading
    })

    // Set isOffline back to false if the portfolio is loading.
    // This is done to prevent the UI from flashing the offline error
    if (!portfolioStateKeys.length || !isAllLoaded) {
      // Skip unnecessary updates
      if (!this.isOffline) return

      this.isOffline = false
      this.emitUpdate()
      return
    }

    const allPortfolioNetworksHaveErrors = portfolioStateKeys.every((chainId) => {
      const state = portfolioState[chainId]

      return !!state?.criticalError
    })

    const allNetworkRpcsAreDown = Object.keys(this.providers.providers).every((chainId) => {
      const provider = this.providers.providers[chainId]
      const isWorking = provider?.isWorking

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
    maxDataAgeMsUnused?: number
  }) {
    const { networks, maxDataAgeMs, maxDataAgeMsUnused, isManualUpdate } = opts || {}

    await this.initialLoadPromise
    if (!this.selectedAccount.account) return
    let signAccountOp = null
    if (this.requests.currentUserRequest && this.requests.currentUserRequest.kind === 'calls') {
      signAccountOp = this.requests.currentUserRequest.signAccountOp
    }
    const canUpdateSignAccountOp = !signAccountOp || signAccountOp.canUpdate()
    if (!canUpdateSignAccountOp) return

    const accountOpsToBeSimulatedByNetwork = getAccountOpsForSimulation(
      this.selectedAccount.account,
      this.requests.visibleUserRequests,
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
      { maxDataAgeMs, maxDataAgeMsUnused, isManualUpdate }
    )
    this.#updateIsOffline()
  }

  async removeActiveRoute(activeRouteId: SwapAndBridgeActiveRoute['activeRouteId']) {
    const userRequest = this.requests.userRequests.find(
      (r) =>
        r.kind === 'calls' &&
        !!r.signAccountOp.accountOp.calls.find((c) => c.activeRouteId === activeRouteId)
    ) as CallsUserRequest | undefined

    if (userRequest) {
      await this.requests.rejectCalls({ activeRouteIds: [activeRouteId] })
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
    this.selectedAccount.removeNetworkData(chainId)
    // Don't remove user activity for now because removing networks
    // is no longer possible in the UI. Users can only disable networks
    // and it doesn't make sense to delete their activity
    // this.activity.removeNetworkData(chainId)

    // Don't remove the defi positions state data because we keep track of the defi positions
    // on the disabled networks so we can suggest enabling them from a dashboard banner
    // this.defiPositions.removeNetworkData(chainId)
  }

  async resolveAccountOpRequest(
    submittedAccountOp: SubmittedAccountOp,
    requestId: CallsUserRequest['id']
  ) {
    const accountOpRequest = this.requests.userRequests.find((r) => r.id === requestId)
    if (!accountOpRequest) return

    const { signAccountOp, dappPromises } = accountOpRequest as CallsUserRequest
    const network = this.networks.networks.find(
      (n) => n.chainId === signAccountOp.accountOp.chainId
    )

    if (!network) return

    const meta: BenzinUserRequest['meta'] = {
      accountAddr: signAccountOp.accountOp.accountAddr,
      chainId: network.chainId,
      txnId: null,
      userOpHash: null
    }

    if (submittedAccountOp) {
      meta.txnId = submittedAccountOp.txnId
      meta.identifiedBy = submittedAccountOp.identifiedBy
      meta.submittedAccountOp = submittedAccountOp
    }

    const benzinUserRequest: BenzinUserRequest = {
      id: new Date().getTime(),
      kind: 'benzin',
      meta,
      dappPromises: []
    }
    await this.requests.addUserRequests([benzinUserRequest], {
      position: 'first',
      skipFocus: true
    })

    await this.requests.removeUserRequests([requestId], { shouldUpdateAccount: false })

    const dappHandlers: any[] = []

    // handle wallet_sendCalls before activity.getConfirmedTxId as 1) it's faster
    // 2) the identifier is different
    dappPromises.forEach((dappPromise) => {
      if (dappPromise.meta.isWalletSendCalls) {
        dappPromise.resolve({ hash: getDappIdentifier(submittedAccountOp) })
      } else {
        dappHandlers.push({ promise: dappPromise, txnId: submittedAccountOp.txnId })
      }
    })

    await this.requests.removeUserRequests([accountOpRequest.id], {
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

  onOneClickSwapClose() {
    // Always unload the screen when the request window is closed
    this.swapAndBridge.unloadScreen('request-window', true)

    const signAccountOp = this.swapAndBridge.signAccountOpController

    if (!signAccountOp) return

    // Remove the active route if it exists
    if (signAccountOp.accountOp.meta?.swapTxn) {
      this.swapAndBridge.removeActiveRoute(signAccountOp.accountOp.meta.swapTxn.activeRouteId)
    }

    const network = this.networks.networks.find(
      (n) => n.chainId === signAccountOp.accountOp.chainId
    )

    this.updateSelectedAccountPortfolio({ networks: network ? [network] : undefined })
    this.emitUpdate()
  }

  onOneClickTransferClose() {
    // Always unload the screen when the request window is closed
    this.transfer.unloadScreen(true)

    const signAccountOp = this.transfer.signAccountOpController

    if (!signAccountOp) return

    const network = this.networks.networks.find(
      (n) => n.chainId === signAccountOp.accountOp.chainId
    )

    this.updateSelectedAccountPortfolio({
      networks: network ? [network] : undefined
    })
    this.emitUpdate()
  }

  // includes the getters in the stringified instance
  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
