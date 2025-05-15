/* eslint-disable @typescript-eslint/brace-style */
import { ethErrors } from 'eth-rpc-errors'
import { getAddress, getBigInt } from 'ethers'

import AmbireAccount7702 from '../../../contracts/compiled/AmbireAccount7702.json'
import EmittableError from '../../classes/EmittableError'
import SwapAndBridgeError from '../../classes/SwapAndBridgeError'
import { ORIGINS_WHITELISTED_TO_ALL_ACCOUNTS } from '../../consts/dappCommunication'
import { AMBIRE_ACCOUNT_FACTORY, SINGLETON } from '../../consts/deploy'
import {
  BIP44_LEDGER_DERIVATION_TEMPLATE,
  BIP44_STANDARD_DERIVATION_TEMPLATE
} from '../../consts/derivation'
import { Account, AccountId, AccountOnchainState } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { DappProviderRequest } from '../../interfaces/dapp'
import { Fetch } from '../../interfaces/fetch'
import { Hex } from '../../interfaces/hex'
import { ExternalSignerControllers, Key, KeystoreSignerType } from '../../interfaces/keystore'
import { AddNetworkRequestParams, Network } from '../../interfaces/network'
import { NotificationManager } from '../../interfaces/notification'
import { RPCProvider } from '../../interfaces/provider'
/* eslint-disable @typescript-eslint/no-floating-promises */
import { TraceCallDiscoveryStatus } from '../../interfaces/signAccountOp'
import { Storage } from '../../interfaces/storage'
import {
  SwapAndBridgeActiveRoute,
  SwapAndBridgeSendTxRequest
} from '../../interfaces/swapAndBridge'
import { Calls, DappUserRequest, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import {
  getDefaultSelectedAccount,
  isBasicAccount,
  isSmartAccount
} from '../../libs/account/account'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { AccountOp, getSignableCalls } from '../../libs/accountOp/accountOp'
import {
  AccountOpIdentifiedBy,
  getDappIdentifier,
  SubmittedAccountOp
} from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
import {
  dappRequestMethodToActionKind,
  getAccountOpActionsByNetwork,
  getAccountOpFromAction
} from '../../libs/actions/actions'
import { getAccountOpBanners } from '../../libs/banners/banners'
import { BROADCAST_OPTIONS, buildRawTransaction } from '../../libs/broadcast/broadcast'
import { getAmbirePaymasterService, getPaymasterService } from '../../libs/erc7677/erc7677'
import { getHumanReadableBroadcastError } from '../../libs/errorHumanizer'
import { insufficientPaymasterFunds } from '../../libs/errorHumanizer/errors'
import {
  ACCOUNT_SWITCH_USER_REQUEST,
  buildSwitchAccountUserRequest,
  getAccountOpsForSimulation,
  makeAccountOpAction
} from '../../libs/main/main'
import { relayerAdditionalNetworks } from '../../libs/networks/networks'
import { TokenResult } from '../../libs/portfolio/interfaces'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { parse } from '../../libs/richJson/richJson'
import { isNetworkReady } from '../../libs/selectedAccount/selectedAccount'
import {
  buildSwapAndBridgeUserRequests,
  getActiveRoutesForAccount
} from '../../libs/swapAndBridge/swapAndBridge'
import { debugTraceCall } from '../../libs/tracer/debugTraceCall'
import {
  buildClaimWalletRequest,
  buildMintVestingRequest,
  buildTransferUserRequest
} from '../../libs/transfer/userRequest'
/* eslint-disable no-underscore-dangle */
import { LiFiAPI } from '../../services/lifi/api'
import { paymasterFactory } from '../../services/paymaster'
import { failedPaymasters } from '../../services/paymaster/FailedPaymasters'
import shortenAddress from '../../utils/shortenAddress'
/* eslint-disable no-await-in-loop */
import { generateUuid } from '../../utils/uuid'
import wait from '../../utils/wait'
import { AccountPickerController } from '../accountPicker/accountPicker'
import { AccountsController } from '../accounts/accounts'
import {
  AccountOpAction,
  ActionExecutionType,
  ActionPosition,
  ActionsController
} from '../actions/actions'
import { ActivityController } from '../activity/activity'
import { AddressBookController } from '../addressBook/addressBook'
import { DappsController } from '../dapps/dapps'
import { DefiPositionsController } from '../defiPositions/defiPositions'
import { DomainsController } from '../domains/domains'
import { EmailVaultController } from '../emailVault/emailVault'
import { EstimationStatus } from '../estimation/types'
import EventEmitter, { ErrorRef, Statuses } from '../eventEmitter/eventEmitter'
import { FeatureFlagsController } from '../featureFlags/featureFlags'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PhishingController } from '../phishing/phishing'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import {
  SIGN_ACCOUNT_OP_MAIN,
  SIGN_ACCOUNT_OP_SWAP,
  SignAccountOpType
} from '../signAccountOp/helper'
import { SignAccountOpController, SigningStatus } from '../signAccountOp/signAccountOp'
import { SignMessageController } from '../signMessage/signMessage'
import { StorageController } from '../storage/storage'
import { SwapAndBridgeController, SwapAndBridgeFormStatus } from '../swapAndBridge/swapAndBridge'

const STATUS_WRAPPED_METHODS = {
  removeAccount: 'INITIAL',
  handleAccountPickerInitLedger: 'INITIAL',
  handleAccountPickerInitTrezor: 'INITIAL',
  handleAccountPickerInitLattice: 'INITIAL',
  importSmartAccountFromDefaultSeed: 'INITIAL',
  buildSwapAndBridgeUserRequest: 'INITIAL',
  selectAccount: 'INITIAL',
  signAndBroadcastAccountOp: 'INITIAL'
} as const

type CustomStatuses = {
  signAndBroadcastAccountOp: 'INITIAL' | 'SIGNING' | 'BROADCASTING' | 'SUCCESS' | 'ERROR'
}

export class MainController extends EventEmitter {
  #storageAPI: Storage

  storage: StorageController

  fetch: Fetch

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  callRelayer: Function

  isReady: boolean = false

  featureFlags: FeatureFlagsController

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

  accountPicker: AccountPickerController

  portfolio: PortfolioController

  defiPositions: DefiPositionsController

  dapps: DappsController

  phishing: PhishingController

  actions: ActionsController

  // Public sub-structures
  // @TODO emailVaults
  emailVault: EmailVaultController

  signMessage: SignMessageController

  swapAndBridge: SwapAndBridgeController

  signAccountOp: SignAccountOpController | null = null

  signAccOpInitError: string | null = null

  activity: ActivityController

  addressBook: AddressBookController

  domains: DomainsController

  accounts: AccountsController

  selectedAccount: SelectedAccountController

  userRequests: UserRequest[] = []

  userRequestWaitingAccountSwitch: UserRequest[] = []

  accountOpsToBeConfirmed: { [key: string]: { [key: string]: AccountOp } } = {}

  // TODO: Temporary solution to expose the fee payer key during Account Op broadcast.
  feePayerKey: Key | null = null

  lastUpdate: Date = new Date()

  isOffline: boolean = false

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> & CustomStatuses = STATUS_WRAPPED_METHODS

  #windowManager: WindowManager

  #notificationManager: NotificationManager

  #signAccountOpSigningPromise?: Promise<AccountOp | void | null>

  #traceCallTimeoutId: ReturnType<typeof setTimeout> | null = null

  /**
   * Tracks broadcast request IDs to abort stale requests.
   * Prevents rejected hardware wallet signatures from affecting new requests
   * when a user closes an action window and starts a new one.
   */
  #signAndBroadcastCallId: string | null = null

  #relayerUrl: string

  constructor({
    storageAPI,
    fetch,
    relayerUrl,
    velcroUrl,
    swapApiKey,
    keystoreSigners,
    externalSignerControllers,
    windowManager,
    notificationManager
  }: {
    storageAPI: Storage
    fetch: Fetch
    relayerUrl: string
    velcroUrl: string
    swapApiKey?: string
    keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>
    externalSignerControllers: ExternalSignerControllers
    windowManager: WindowManager
    notificationManager: NotificationManager
  }) {
    super()
    this.#storageAPI = storageAPI
    this.fetch = fetch
    this.#windowManager = windowManager
    this.#notificationManager = notificationManager

    this.storage = new StorageController(this.#storageAPI)
    this.invite = new InviteController({ relayerUrl, fetch, storage: this.storage })
    this.keystore = new KeystoreController(this.storage, keystoreSigners, windowManager)
    this.#externalSignerControllers = externalSignerControllers
    this.networks = new NetworksController(
      this.storage,
      this.fetch,
      relayerUrl,
      async (network: Network) => {
        if (network.disabled) {
          await this.removeNetworkData(network.chainId)
          return
        }
        this.providers.setProvider(network)
        await this.reloadSelectedAccount({ chainId: network.chainId })
      },
      (chainId: bigint) => {
        this.providers.removeProvider(chainId)
      }
    )
    this.featureFlags = new FeatureFlagsController(this.networks)
    this.providers = new ProvidersController(this.networks)
    this.accounts = new AccountsController(
      this.storage,
      this.providers,
      this.networks,
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
      accounts: this.accounts
    })
    this.portfolio = new PortfolioController(
      this.storage,
      this.fetch,
      this.providers,
      this.networks,
      this.accounts,
      this.keystore,
      relayerUrl,
      velcroUrl
    )
    this.defiPositions = new DefiPositionsController({
      fetch: this.fetch,
      storage: this.storage,
      selectedAccount: this.selectedAccount,
      networks: this.networks,
      providers: this.providers
    })
    this.emailVault = new EmailVaultController(this.storage, this.fetch, relayerUrl, this.keystore)
    this.#relayerUrl = relayerUrl
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
      this.invite,
      () => {
        if (this.signMessage.signingKeyType === 'trezor') {
          this.#handleTrezorCleanup()
        }
      }
    )
    this.phishing = new PhishingController({
      fetch: this.fetch,
      storage: this.storage,
      windowManager: this.#windowManager
    })
    // const socketAPI = new SocketAPI({ apiKey: swapApiKey, fetch: this.fetch })
    const lifiAPI = new LiFiAPI({ apiKey: swapApiKey, fetch: this.fetch })
    this.dapps = new DappsController(this.storage)
    this.actions = new ActionsController({
      selectedAccount: this.selectedAccount,
      windowManager,
      notificationManager,
      onActionWindowClose: () => {
        const userRequestsToRejectOnWindowClose = this.userRequests.filter(
          (r) => r.action.kind !== 'calls'
        )
        userRequestsToRejectOnWindowClose.forEach((r) =>
          this.rejectUserRequest(ethErrors.provider.userRejectedRequest().message, r.id)
        )

        this.userRequestWaitingAccountSwitch = []
        this.emitUpdate()
      }
    })
    this.selectedAccount.initControllers({
      portfolio: this.portfolio,
      defiPositions: this.defiPositions,
      actions: this.actions,
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
      async (network: Network) => {
        await this.setContractsDeployedToTrueIfDeployed(network)
      }
    )
    this.swapAndBridge = new SwapAndBridgeController({
      accounts: this.accounts,
      keystore: this.keystore,
      portfolio: this.portfolio,
      externalSignerControllers: this.#externalSignerControllers,
      providers: this.providers,
      selectedAccount: this.selectedAccount,
      networks: this.networks,
      activity: this.activity,
      invite: this.invite,
      // TODO: This doesn't work, because the invite controller is not yet loaded at this stage
      // serviceProviderAPI: this.invite.isOG ? lifiAPI : socketAPI,
      serviceProviderAPI: lifiAPI,
      storage: this.storage,
      actions: this.actions,
      relayerUrl,
      portfolioUpdate: () => {
        this.updateSelectedAccountPortfolio(true)
      },
      userRequests: this.userRequests,
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
      }
    })
    this.domains = new DomainsController(this.providers.providers)

    this.#initialLoadPromise = this.#load()
    paymasterFactory.init(relayerUrl, fetch, (e: ErrorRef) => {
      if (!this.signAccountOp) return
      this.emitError(e)
    })

    this.keystore.onUpdate(() => {
      if (this.keystore.statuses.unlockWithSecret === 'SUCCESS') {
        this.storage.associateAccountKeysWithLegacySavedSeedMigration(
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
  }

  /**
   * - Updates the selected account's account state, portfolio and defi positions
   * - Calls batchReverseLookup for all accounts
   *
   * It's not a problem to call it many times consecutively as all methods have internal
   * caching mechanisms to prevent unnecessary calls.
   */
  onPopupOpen() {
    const FIVE_MINUTES = 1000 * 60 * 5
    const selectedAccountAddr = this.selectedAccount.account?.addr
    this.domains.batchReverseLookup(this.accounts.accounts.map((a) => a.addr))
    if (!this.activity.broadcastedButNotConfirmed.length) {
      // Update defi positions together with the portfolio for simplicity
      this.defiPositions.updatePositions({ maxDataAgeMs: FIVE_MINUTES })
      this.updateSelectedAccountPortfolio(undefined, undefined, FIVE_MINUTES)
    }

    if (selectedAccountAddr && !this.accounts.areAccountStatesLoading)
      this.accounts.updateAccountState(selectedAccountAddr)
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
    this.emailVault.cleanMagicAndSessionKeys()
    this.selectedAccount.setDashboardNetworkFilter(null)
  }

  async selectAccount(toAccountAddr: string) {
    await this.withStatus('selectAccount', async () => this.#selectAccount(toAccountAddr), true)
  }

  async #selectAccount(toAccountAddr: string | null) {
    await this.#initialLoadPromise
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
    if (this.actions?.currentAction?.type !== 'switchAccount') {
      this.actions.closeActionWindow()
    }
    const swapAndBridgeSigningAction = this.actions.visibleActionsQueue.find(
      ({ type }) => type === 'swapAndBridge'
    )
    if (swapAndBridgeSigningAction) {
      this.actions.removeAction(swapAndBridgeSigningAction.id)
    }
    this.selectedAccount.setAccount(accountToSelect)
    this.swapAndBridge.reset()
    await this.dapps.broadcastDappSessionEvent('accountsChanged', [toAccountAddr])
    // forceEmitUpdate to update the getters in the FE state of the ctrl
    await this.forceEmitUpdate()
    await this.actions.forceEmitUpdate()
    await this.addressBook.forceEmitUpdate()
    // Don't await these as they are not critical for the account selection
    // and if the user decides to quickly change to another account withStatus
    // will block the UI until these are resolved.
    this.reloadSelectedAccount({ forceUpdate: false })
    this.emitUpdate()
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
    const accountOp = getAccountOpFromAction(actionId, this.actions.actionsQueue)
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
      this.signAccountOp = new SignAccountOpController(
        this.accounts,
        this.networks,
        this.keystore,
        this.portfolio,
        this.#externalSignerControllers,
        this.selectedAccount.account,
        network,
        this.providers.providers[network.chainId.toString()],
        actionId,
        accountOp,
        () => {
          return this.isSignRequestStillActive
        },
        true,
        (ctrl: SignAccountOpController) => {
          this.traceCall(ctrl)
        }
      )
    }

    this.emitUpdate()
  }

  async handleSignAndBroadcastAccountOp(type: SignAccountOpType) {
    if (this.statuses.signAndBroadcastAccountOp !== 'INITIAL') {
      this.emitError({
        level: 'major',
        message: 'The signing process is already in progress.',
        error: new Error(
          'The signing process is already in progress. (handleSignAndBroadcastAccountOp)'
        )
      })
      return
    }

    const signAndBroadcastCallId = generateUuid()
    this.#signAndBroadcastCallId = signAndBroadcastCallId

    this.statuses.signAndBroadcastAccountOp = 'SIGNING'
    this.forceEmitUpdate()

    const signAccountOp =
      type === SIGN_ACCOUNT_OP_MAIN
        ? this.signAccountOp
        : this.swapAndBridge.signAccountOpController

    // if the accountOp has a swapTxn, start the route as the user is broadcasting it
    if (signAccountOp?.accountOp.meta?.swapTxn) {
      await this.swapAndBridge.addActiveRoute({
        activeRouteId: signAccountOp?.accountOp.meta?.swapTxn.activeRouteId,
        userTxIndex: signAccountOp?.accountOp.meta?.swapTxn.userTxIndex
      })
    }

    if (type === SIGN_ACCOUNT_OP_SWAP) {
      this.swapAndBridge.signAccountOpController?.simulateSwapOrBridge().then(() => {
        // if an error has ocurred while signing and we're back to SigningStatus.ReadyToSign,
        // override the pending results as they will be incorrect
        if (
          this.swapAndBridge.signAccountOpController &&
          this.swapAndBridge.signAccountOpController.status?.type === SigningStatus.ReadyToSign
        ) {
          this.portfolio.overridePendingResults(
            this.swapAndBridge.signAccountOpController.accountOp
          )
        }
      })
    }

    const wasAlreadySigned = signAccountOp?.status?.type === SigningStatus.Done

    if (!wasAlreadySigned) {
      if (!signAccountOp) {
        const message =
          'The signing process was not initialized as expected. Please try again later or contact Ambire support if the issue persists.'

        throw new EmittableError({ level: 'major', message })
      }

      // Reset the promise in the `finally` block to ensure it doesn't remain unresolved if an error is thrown
      this.#signAccountOpSigningPromise = signAccountOp.sign().finally(() => {
        if (this.#signAndBroadcastCallId !== signAndBroadcastCallId) return

        this.#signAccountOpSigningPromise = undefined
      })

      await this.#signAccountOpSigningPromise
    }

    if (this.#signAndBroadcastCallId !== signAndBroadcastCallId) return

    // Error handling on the prev step will notify the user, it's fine to return here
    if (signAccountOp?.status?.type !== SigningStatus.Done) {
      // remove the active route on signing failure
      if (signAccountOp?.accountOp.meta?.swapTxn) {
        this.swapAndBridge.removeActiveRoute(signAccountOp.accountOp.meta.swapTxn.activeRouteId)
      }
      this.statuses.signAndBroadcastAccountOp = 'ERROR'
      await this.forceEmitUpdate()
      this.statuses.signAndBroadcastAccountOp = 'INITIAL'
      this.#signAndBroadcastCallId = null
      await this.forceEmitUpdate()
      return
    }

    try {
      await this.#broadcastSignedAccountOp(signAccountOp, type, signAndBroadcastCallId)
      if (signAndBroadcastCallId === this.#signAndBroadcastCallId) {
        this.statuses.signAndBroadcastAccountOp = 'SUCCESS'
        await this.forceEmitUpdate()
      }
    } catch (error: any) {
      if (signAndBroadcastCallId === this.#signAndBroadcastCallId) {
        if ('message' in error && 'level' in error && 'error' in error) {
          this.emitError(error)
        } else {
          this.emitError({
            level: 'major',
            message: error.message || 'Unknown error occurred while broadcasting the transaction',
            error
          })
        }
        this.statuses.signAndBroadcastAccountOp = 'ERROR'
        await this.forceEmitUpdate()
      }
    } finally {
      if (signAndBroadcastCallId === this.#signAndBroadcastCallId) {
        this.statuses.signAndBroadcastAccountOp = 'INITIAL'
        this.#signAndBroadcastCallId = null
        await this.forceEmitUpdate()
      }
    }
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

  #abortHWSign(signAccountOp: SignAccountOpController) {
    if (!signAccountOp) return

    const isAwaitingHWSignature =
      (signAccountOp.accountOp.signingKeyType !== 'internal' &&
        this.statuses.signAndBroadcastAccountOp === 'SIGNING') ||
      (this.feePayerKey?.type !== 'internal' &&
        this.statuses.signAndBroadcastAccountOp === 'BROADCASTING')

    // Reset these flags only if we were awaiting a HW signature
    // to broadcast a transaction.
    // If the user is using a hot wallet we can sign the transaction immediately
    // and once its signed there is no way to cancel the broadcast. Once the user
    // On the other hand HWs can be in 'SIGNING' or 'BROADCASTING' state
    // and be able to 'cancel' the broadcast.
    if (isAwaitingHWSignature) {
      this.statuses.signAndBroadcastAccountOp = 'INITIAL'
      this.#signAndBroadcastCallId = null
    }

    const isSignerTrezor =
      signAccountOp.accountOp.signingKeyType === 'trezor' || this.feePayerKey?.type === 'trezor'

    if (isSignerTrezor) {
      this.#handleTrezorCleanup()
    }
    this.#signAccountOpSigningPromise = undefined
  }

  destroySignAccOp() {
    if (!this.signAccountOp) return

    this.#abortHWSign(this.signAccountOp)
    this.feePayerKey = null
    this.signAccountOp.reset()
    this.signAccountOp = null
    this.signAccOpInitError = null

    // NOTE: no need to update the portfolio here as an update is
    // fired upon removeUserRequest

    this.emitUpdate()
  }

  async traceCall(signAccountOpCtrl: SignAccountOpController) {
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
      const learnedNewNfts = await this.portfolio.learnNfts(nfts, network.chainId)
      const accountOpsForSimulation = getAccountOpsForSimulation(
        account,
        this.actions.visibleActionsQueue,
        this.networks.networks
      )

      // update the portfolio only if new tokens were found through tracing
      const canUpdateSignAccountOp = !signAccountOpCtrl || signAccountOpCtrl.canUpdate()
      if (canUpdateSignAccountOp && (learnedNewTokens || learnedNewNfts)) {
        await this.portfolio.updateSelectedAccount(
          accountOp.accountAddr,
          network,
          accountOpsForSimulation
            ? {
                accountOps: accountOpsForSimulation,
                states: await this.accounts.getOrFetchAccountStates(account.addr)
              }
            : undefined,
          { forceUpdate: true }
        )
      }

      signAccountOpCtrl.setDiscoveryStatus(TraceCallDiscoveryStatus.Done)
    } catch (e: any) {
      signAccountOpCtrl.setDiscoveryStatus(TraceCallDiscoveryStatus.Failed)

      this.emitError({
        level: 'silent',
        message: 'Error in main.traceCall',
        error: new Error(`Debug trace call error on ${network.name}: ${e.message}`)
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

    this.resolveUserRequest({ hash: signedMessage.signature }, signedMessage.fromActionId)

    await this.#notificationManager.create({
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
      await ledgerCtrl.unlock(hdPathTemplate)

      if (!ledgerCtrl.walletSDK) {
        const message = 'Could not establish connection with the Ledger device'
        throw new EmittableError({ message, level: 'major', error: new Error(message) })
      }

      const keyIterator = new LedgerKeyIterator({ controller: ledgerCtrl })
      await this.accountPicker.setInitParams({
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
    await this.#initialLoadPromise

    const { shouldEmitUpdate, shouldUpdatePortfolio, updatedAccountsOps, newestOpTimestamp } =
      await this.activity.updateAccountsOpsStatuses()

    if (shouldEmitUpdate) {
      this.emitUpdate()

      if (shouldUpdatePortfolio) {
        this.updateSelectedAccountPortfolio(true)
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
    await this.#initialLoadPromise
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
      this.actions.removeAccountData(address)
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

  async #ensureAccountInfo(
    accountAddr: AccountId,
    chainId: bigint
  ): Promise<{ hasAccountInfo: true } | { hasAccountInfo: false; errorMessage: string }> {
    await this.#initialLoadPromise
    // Initial sanity check: does this account even exist?
    if (!this.accounts.accounts.find((x) => x.addr === accountAddr)) {
      return {
        hasAccountInfo: false,
        errorMessage: `Account ${accountAddr} does not exist`
      }
    }
    // If this still didn't work, re-load
    if (!this.accounts.accountStates[accountAddr]?.[chainId.toString()])
      await this.accounts.updateAccountState(accountAddr, 'pending', [chainId])
    // If this still didn't work, throw error: this prob means that we're calling for a non-existent acc/network
    if (!this.accounts.accountStates[accountAddr]?.[chainId.toString()]) {
      const network = this.networks.networks.find((n) => n.chainId === chainId)

      return {
        hasAccountInfo: false,
        errorMessage: `We couldn't complete your last action because we couldn't retrieve your account information for ${
          network?.name || chainId
        }. Please try reloading your account from the Dashboard. If the issue persists, contact support for assistance.`
      }
    }

    return {
      hasAccountInfo: true
    }
  }

  #batchCallsFromUserRequests(accountAddr: AccountId, chainId: bigint): Call[] {
    // Note: we use reduce instead of filter/map so that the compiler can deduce that we're checking .kind
    return (this.userRequests.filter((r) => r.action.kind === 'calls') as SignUserRequest[]).reduce(
      (uCalls: Call[], req) => {
        if (req.meta.chainId === chainId && req.meta.accountAddr === accountAddr) {
          const { calls } = req.action as Calls
          calls.map((call) => uCalls.push({ ...call, fromUserRequestId: req.id }))
        }
        return uCalls
      },
      []
    )
  }

  async reloadSelectedAccount(options?: { forceUpdate?: boolean; chainId?: bigint }) {
    const { forceUpdate = true, chainId } = options || {}
    const networkToUpdate = chainId
      ? this.networks.networks.find((n) => n.chainId === chainId)
      : undefined
    if (!this.selectedAccount.account) return

    this.selectedAccount.resetSelectedAccountPortfolio()
    await Promise.all([
      // When we trigger `reloadSelectedAccount` (for instance, from Dashboard -> Refresh balance icon),
      // it's very likely that the account state is already in the process of being updated.
      // If we try to run the same action, `withStatus` validation will throw an error.
      // So, we perform this safety check to prevent the error.
      // However, even if we don't trigger an update here, it's not a big problem,
      // as the account state will be updated anyway, and its update will be very recent.
      !this.accounts.areAccountStatesLoading && this.selectedAccount.account?.addr
        ? this.accounts.updateAccountState(
            this.selectedAccount.account.addr,
            'pending',
            chainId ? [chainId] : undefined
          )
        : Promise.resolve(),
      // `updateSelectedAccountPortfolio` doesn't rely on `withStatus` validation internally,
      // as the PortfolioController already exposes flags that are highly sufficient for the UX.
      // Additionally, if we trigger the portfolio update twice (i.e., running a long-living interval + force update from the Dashboard),
      // there won't be any error thrown, as all portfolio updates are queued and they don't use the `withStatus` helper.
      this.updateSelectedAccountPortfolio(forceUpdate, networkToUpdate),
      this.defiPositions.updatePositions({ chainId })
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

  // TODO: Refactor this to accept an optional object with options
  async updateSelectedAccountPortfolio(
    // eslint-disable-next-line default-param-last
    forceUpdate: boolean = false,
    network?: Network,
    maxDataAgeMs?: number
  ) {
    await this.#initialLoadPromise
    if (!this.selectedAccount.account) return
    const canUpdateSignAccountOp = !this.signAccountOp || this.signAccountOp.canUpdate()
    if (!canUpdateSignAccountOp) return

    const accountOpsToBeSimulatedByNetwork = getAccountOpsForSimulation(
      this.selectedAccount.account,
      this.actions.visibleActionsQueue,
      this.networks.networks
    )

    await this.portfolio.updateSelectedAccount(
      this.selectedAccount.account.addr,
      network,
      accountOpsToBeSimulatedByNetwork
        ? {
            accountOps: accountOpsToBeSimulatedByNetwork,
            states: await this.accounts.getOrFetchAccountStates(this.selectedAccount.account.addr)
          }
        : undefined,
      { forceUpdate, maxDataAgeMs }
    )
    this.#updateIsOffline()
  }

  #getUserRequestAccountError(dappOrigin: string, fromAccountAddr: string): string | null {
    if (ORIGINS_WHITELISTED_TO_ALL_ACCOUNTS.includes(dappOrigin)) {
      const isAddressInAccounts = this.accounts.accounts.some((a) => a.addr === fromAccountAddr)

      if (isAddressInAccounts) return null

      return 'The dApp is trying to sign using an address that is not imported in the extension.'
    }
    const isAddressSelected = this.selectedAccount.account?.addr === fromAccountAddr

    if (isAddressSelected) return null

    return 'The dApp is trying to sign using an address that is not selected in the extension.'
  }

  /**
   * Don't allow the user to open new action windows if there's a pending to sign swap action.
   * This is done to prevent complications with the signing process- e.g. a new request
   * being sent to the hardware wallet while the swap and bridge one is still pending.
   * @returns {boolean} - true if an error was thrown
   * @throws {Error} - if throwRpcError is true
   */
  async #swapAndBridgeActionSafeguard(throwRpcError = false): Promise<boolean> {
    const pendingSwapAction = this.actions.visibleActionsQueue.find(
      ({ type }) => type === 'swapAndBridge'
    )

    if (!pendingSwapAction) return false

    const isSigningOrBroadcasting =
      this.statuses.signAndBroadcastAccountOp === 'SIGNING' ||
      this.statuses.signAndBroadcastAccountOp === 'BROADCASTING'

    // The swap and bridge is done/forgotten so we can remove the action
    if (!isSigningOrBroadcasting) {
      this.actions.removeAction(pendingSwapAction.id)
      this.swapAndBridge.reset()
      // TODO: remove this ugly fix.
      // Issue: https://github.com/AmbireTech/ambire-app/issues/4469
      await wait(500)
      return false
    }

    this.actions.focusActionWindow()
    this.emitError({
      level: 'major',
      message: 'Please complete the pending swap action.',
      error: new Error('Pending swap action')
    })

    if (throwRpcError) {
      throw ethErrors.rpc.transactionRejected({
        message: 'You have a pending swap action. Please complete it before signing.'
      })
    }

    return true
  }

  async buildUserRequestFromDAppRequest(
    request: DappProviderRequest,
    dappPromise: {
      session: { name: string; origin: string; icon: string }
      resolve: (data: any) => void
      reject: (data: any) => void
    }
  ) {
    await this.#initialLoadPromise
    await this.#swapAndBridgeActionSafeguard(true)

    let userRequest = null
    let actionPosition: ActionPosition = 'last'
    const kind = dappRequestMethodToActionKind(request.method)
    const dapp = this.dapps.getDapp(request.origin)

    if (kind === 'calls') {
      if (!this.selectedAccount.account) throw ethErrors.rpc.internal()
      const network = this.networks.networks.find(
        (n) => Number(n.chainId) === Number(dapp?.chainId)
      )
      if (!network) {
        throw ethErrors.provider.chainDisconnected('Transaction failed - unknown network')
      }

      const baseAcc = getBaseAccount(
        this.selectedAccount.account,
        await this.accounts.getOrFetchAccountOnChainState(
          this.selectedAccount.account.addr,
          network.chainId
        ),
        this.keystore.getAccountKeys(this.selectedAccount.account),
        network
      )

      const isWalletSendCalls = !!request.params[0].calls
      const accountAddr = getAddress(request.params[0].from)

      const calls: Calls['calls'] = isWalletSendCalls
        ? request.params[0].calls
        : [request.params[0]]
      const paymasterService =
        isWalletSendCalls && !!request.params[0].capabilities?.paymasterService
          ? getPaymasterService(network.chainId, request.params[0].capabilities)
          : getAmbirePaymasterService(baseAcc, this.#relayerUrl)

      const atomicRequired = isWalletSendCalls && !!request.params[0].atomicRequired
      if (isWalletSendCalls && atomicRequired && baseAcc.getAtomicStatus() === 'unsupported') {
        throw ethErrors.provider.custom({
          code: 5700,
          message: 'Transaction failed - atomicity is not supported for this account'
        })
      }

      const walletSendCallsVersion = isWalletSendCalls
        ? request.params[0].version ?? '1.0.0'
        : undefined

      userRequest = {
        id: new Date().getTime(),
        action: {
          kind,
          calls: calls.map((call) => ({
            to: call.to,
            data: call.data || '0x',
            value: call.value ? getBigInt(call.value) : 0n
          }))
        },
        meta: {
          isSignAction: true,
          isWalletSendCalls,
          walletSendCallsVersion,
          accountAddr,
          chainId: network.chainId,
          paymasterService
        },
        dappPromise
      } as SignUserRequest

      const accountState = await this.accounts.getOrFetchAccountOnChainState(
        accountAddr,
        network.chainId
      )
      if (isBasicAccount(this.selectedAccount.account, accountState)) {
        const otherUserRequestFromSameDapp = this.userRequests.find(
          (r) => r.dappPromise?.session?.origin === dappPromise?.session?.origin
        )

        if (!otherUserRequestFromSameDapp && !!dappPromise?.session?.origin) {
          actionPosition = 'first'
        }
      }
    } else if (kind === 'message') {
      if (!this.selectedAccount.account) throw ethErrors.rpc.internal()

      const msg = request.params
      if (!msg) {
        throw ethErrors.rpc.invalidRequest('No msg request to sign')
      }
      const msgAddress = getAddress(msg?.[1])

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
          accountAddr: msgAddress,
          chainId: network.chainId
        },
        dappPromise
      } as SignUserRequest
    } else if (kind === 'typedMessage') {
      if (!this.selectedAccount.account) throw ethErrors.rpc.internal()

      const msg = request.params
      if (!msg) {
        throw ethErrors.rpc.invalidRequest('No msg request to sign')
      }
      const msgAddress = getAddress(msg?.[0])

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

      if (
        msgAddress === this.selectedAccount.account.addr &&
        (typedData.primaryType === 'AmbireOperation' || !!typedData.types.AmbireOperation)
      ) {
        throw ethErrors.rpc.methodNotSupported('Signing an AmbireOperation is not allowed')
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
          accountAddr: msgAddress,
          chainId: network.chainId
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

    if (userRequest.action.kind !== 'calls') {
      const otherUserRequestFromSameDapp = this.userRequests.find(
        (r) => r.dappPromise?.session?.origin === dappPromise?.session?.origin
      )

      if (!otherUserRequestFromSameDapp && !!dappPromise?.session?.origin) {
        actionPosition = 'first'
      }
    }

    if (!userRequest) return

    const isASignOperationRequestedForAnotherAccount =
      userRequest.meta.isSignAction &&
      userRequest.meta.accountAddr !== this.selectedAccount.account?.addr

    // We can simply add the user request if it's not a sign operation
    // for another account
    if (!isASignOperationRequestedForAnotherAccount) {
      await this.addUserRequest(
        userRequest,
        actionPosition,
        actionPosition === 'first' || isSmartAccount(this.selectedAccount.account)
          ? 'open-action-window'
          : 'queue-but-open-action-window'
      )
      return
    }

    const accountError = this.#getUserRequestAccountError(
      dappPromise.session.origin,
      userRequest.meta.accountAddr
    )

    if (accountError) {
      dappPromise.reject(ethErrors.provider.userRejectedRequest(accountError))
      return
    }

    const network = this.networks.networks.find((n) => Number(n.chainId) === Number(dapp?.chainId))

    if (!network) {
      throw ethErrors.provider.chainDisconnected('Transaction failed - unknown network')
    }

    this.userRequestWaitingAccountSwitch.push(userRequest)
    await this.addUserRequest(
      buildSwitchAccountUserRequest({
        nextUserRequest: userRequest,
        chainId: network.chainId,
        selectedAccountAddr: userRequest.meta.accountAddr,
        session: dappPromise.session,
        dappPromise
      }),
      'last',
      'open-action-window'
    )
  }

  async buildTransferUserRequest(
    amount: string,
    recipientAddress: string,
    selectedToken: TokenResult,
    actionExecutionType: ActionExecutionType = 'open-action-window'
  ) {
    await this.#initialLoadPromise
    if (!this.selectedAccount.account) return

    const baseAcc = getBaseAccount(
      this.selectedAccount.account,
      await this.accounts.getOrFetchAccountOnChainState(
        this.selectedAccount.account.addr,
        selectedToken.chainId
      ),
      this.keystore.getAccountKeys(this.selectedAccount.account),
      this.networks.networks.find((net) => net.chainId === selectedToken.chainId)!
    )
    const userRequest = buildTransferUserRequest({
      selectedAccount: this.selectedAccount.account.addr,
      amount,
      selectedToken,
      recipientAddress,
      paymasterService: getAmbirePaymasterService(baseAcc, this.#relayerUrl)
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

    await this.addUserRequest(userRequest, 'last', actionExecutionType)
  }

  async buildSwapAndBridgeUserRequest(activeRouteId?: SwapAndBridgeActiveRoute['activeRouteId']) {
    await this.withStatus(
      'buildSwapAndBridgeUserRequest',
      async () => {
        if (!this.selectedAccount.account) return
        let transaction: SwapAndBridgeSendTxRequest | null | undefined = null

        const activeRoute = this.swapAndBridge.activeRoutes.find(
          (r) => r.activeRouteId === activeRouteId
        )

        // learn the receiving token
        if (this.swapAndBridge.toSelectedToken && this.swapAndBridge.toChainId) {
          this.portfolio.addTokensToBeLearned(
            [this.swapAndBridge.toSelectedToken.address],
            BigInt(this.swapAndBridge.toChainId)
          )
        }

        if (this.swapAndBridge.signAccountOpController?.accountOp.meta?.swapTxn) {
          transaction = this.swapAndBridge.signAccountOpController?.accountOp.meta?.swapTxn
        }

        if (activeRoute) {
          this.removeUserRequest(activeRoute.activeRouteId, {
            shouldRemoveSwapAndBridgeRoute: false,
            shouldOpenNextRequest: false
          })
          this.swapAndBridge.updateActiveRoute(activeRoute.activeRouteId, { error: undefined })

          transaction = await this.swapAndBridge.getNextRouteUserTx({
            activeRouteId: activeRoute.activeRouteId,
            activeRoute
          })

          if (transaction) {
            const network = this.networks.networks.find(
              (n) => Number(n.chainId) === transaction!.chainId
            )!
            if (
              isBasicAccount(
                this.selectedAccount.account,
                await this.accounts.getOrFetchAccountOnChainState(
                  this.selectedAccount.account.addr,
                  network.chainId
                )
              )
            ) {
              this.removeUserRequest(`${activeRouteId}-revoke-approval`, {
                shouldRemoveSwapAndBridgeRoute: false,
                shouldOpenNextRequest: false
              })
              this.removeUserRequest(`${activeRouteId}-approval`, {
                shouldRemoveSwapAndBridgeRoute: false,
                shouldOpenNextRequest: false
              })
            }
          }
        }

        if (!this.selectedAccount.account || !transaction) {
          const errorDetails = `missing ${
            this.selectedAccount.account ? 'selected account' : 'transaction'
          } info`
          const error = new SwapAndBridgeError(
            `Something went wrong when preparing your request. Please try again later or contact Ambire support. Error details: <${errorDetails}>`
          )
          throw new EmittableError({ message: error.message, level: 'major', error })
        }

        const network = this.networks.networks.find(
          (n) => Number(n.chainId) === transaction!.chainId
        )!

        // TODO: Consider refining the error handling in here, because this
        // swallows errors and doesn't provide any feedback to the user.
        const accountState = await this.accounts.getOrFetchAccountOnChainState(
          this.selectedAccount.account.addr,
          network.chainId
        )
        const baseAcc = getBaseAccount(
          this.selectedAccount.account,
          accountState,
          this.keystore.getAccountKeys(this.selectedAccount.account),
          network
        )
        const swapAndBridgeUserRequests = await buildSwapAndBridgeUserRequests(
          transaction,
          network.chainId,
          this.selectedAccount.account,
          this.providers.providers[network.chainId.toString()],
          accountState,
          getAmbirePaymasterService(baseAcc, this.#relayerUrl)
        )

        for (let i = 0; i < swapAndBridgeUserRequests.length; i++) {
          if (i === 0) {
            this.addUserRequest(swapAndBridgeUserRequests[i], 'last', 'queue')
          } else {
            await this.addUserRequest(swapAndBridgeUserRequests[i], 'last', 'queue')
          }
        }

        if (this.swapAndBridge.formStatus === SwapAndBridgeFormStatus.ReadyToSubmit) {
          await this.swapAndBridge.addActiveRoute({
            activeRouteId: transaction.activeRouteId,
            userTxIndex: transaction.userTxIndex
          })
        }

        if (activeRouteId) {
          this.swapAndBridge.updateActiveRoute(
            activeRouteId,
            {
              userTxIndex: transaction.userTxIndex,
              userTxHash: null
            },
            true
          )
        }

        this.swapAndBridge.resetForm()
      },
      true
    )
  }

  buildClaimWalletUserRequest(token: TokenResult) {
    if (!this.selectedAccount.account) return

    const claimableRewardsData =
      this.selectedAccount.portfolio.latest.rewards?.result?.claimableRewardsData

    if (!claimableRewardsData) return

    const userRequest: UserRequest = buildClaimWalletRequest({
      selectedAccount: this.selectedAccount.account.addr,
      selectedToken: token,
      claimableRewardsData
    })

    this.addUserRequest(userRequest)
  }

  buildMintVestingUserRequest(token: TokenResult) {
    if (!this.selectedAccount.account) return

    const addrVestingData = this.selectedAccount.portfolio.latest.rewards?.result?.addrVestingData

    if (!addrVestingData) return
    const userRequest: UserRequest = buildMintVestingRequest({
      selectedAccount: this.selectedAccount.account.addr,
      selectedToken: token,
      addrVestingData
    })

    this.addUserRequest(userRequest)
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
    if (!userRequest) return

    // if the userRequest that is about to be removed is an approval request
    // find and remove the associated pending transaction request if there is any
    // this is valid scenario for a swap & bridge txs with a BA
    if (userRequest.action.kind === 'calls') {
      const acc = this.accounts.accounts.find((a) => a.addr === userRequest.meta.accountAddr)!

      if (
        isBasicAccount(acc, this.accounts.accountStates[acc.addr][userRequest.meta.chainId]) &&
        userRequest.meta.isSwapAndBridgeCall
      ) {
        this.removeUserRequest(userRequest.meta.activeRouteId)
        this.removeUserRequest(`${userRequest.meta.activeRouteId}-approval`)
        this.removeUserRequest(`${userRequest.meta.activeRouteId}-revoke-approval`)
      }
    }

    userRequest.dappPromise?.reject(ethErrors.provider.userRejectedRequest<any>(err))
    this.removeUserRequest(requestId)
  }

  rejectSignAccountOpCall(callId: string) {
    if (!this.signAccountOp) return

    const { calls, chainId, accountAddr } = this.signAccountOp.accountOp

    const requestId = calls.find((c) => c.id === callId)?.fromUserRequestId
    if (requestId) {
      const userRequestIndex = this.userRequests.findIndex((r) => r.id === requestId)
      const userRequest = this.userRequests[userRequestIndex] as SignUserRequest
      if (userRequest.action.kind === 'calls') {
        ;(userRequest.action as Calls).calls = (userRequest.action as Calls).calls.filter(
          (c) => c.id !== callId
        )

        if (userRequest.action.calls.length === 0) {
          // the reject will remove the userRequest which will rebuild the action and update the signAccountOp
          this.rejectUserRequest('User rejected the transaction request.', userRequest.id)
        } else {
          const accountOpAction = makeAccountOpAction({
            account: this.accounts.accounts.find((a) => a.addr === accountAddr)!,
            chainId,
            nonce: this.accounts.accountStates[accountAddr][chainId.toString()].nonce,
            userRequests: this.userRequests,
            actionsQueue: this.actions.actionsQueue
          })

          this.actions.addOrUpdateAction(accountOpAction)
          this.signAccountOp?.update({ calls: accountOpAction.accountOp.calls })
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

  removeActiveRoute(activeRouteId: SwapAndBridgeActiveRoute['activeRouteId']) {
    const userRequest = this.userRequests.find((r) =>
      [activeRouteId, `${activeRouteId}-approval`, `${activeRouteId}-revoke-approval`].includes(
        r.id as string
      )
    )

    if (userRequest) {
      this.rejectUserRequest('User rejected the transaction request.', userRequest.id)
    } else {
      this.swapAndBridge.removeActiveRoute(activeRouteId)
    }
  }

  async addUserRequest(
    req: UserRequest,
    actionPosition: ActionPosition = 'last',
    actionExecutionType: ActionExecutionType = 'open-action-window'
  ) {
    const shouldSkipAddUserRequest = await this.#swapAndBridgeActionSafeguard()

    if (shouldSkipAddUserRequest) return

    if (req.action.kind === 'calls') {
      ;(req.action as Calls).calls.forEach((_, i) => {
        ;(req.action as Calls).calls[i].id = `${req.id}-${i}`
      })
    }
    if (actionPosition === 'first') {
      this.userRequests.unshift(req)
    } else {
      this.userRequests.push(req)
    }

    const { id, action, meta } = req
    if (action.kind === 'calls') {
      // @TODO
      // one solution would be to, instead of checking, have a promise that we always await here, that is responsible for fetching
      // account data; however, this won't work with EOA accountOps, which have to always pick the first userRequest for a particular acc/network,
      // and be recalculated when one gets dismissed
      // although it could work like this: 1) await the promise, 2) check if exists 3) if not, re-trigger the promise;
      // 4) manage recalc on removeUserRequest too in order to handle EOAs
      // @TODO consider re-using this whole block in removeUserRequest
      const accountInfo = await this.#ensureAccountInfo(meta.accountAddr, meta.chainId)
      if (!accountInfo.hasAccountInfo) {
        // Reject request if we couldn't load the account and account state for the request
        req.dappPromise?.reject(
          ethErrors.provider.custom({
            code: 1001,
            message: accountInfo.errorMessage
          })
        )

        // Remove the request as it's already added
        this.removeUserRequest(req.id)

        // Show a toast
        throw new EmittableError({
          level: 'major',
          message: accountInfo.errorMessage,
          error: new Error(
            `Couldn't retrieve account information for network with id ${meta.chainId}, because of one of the following reasons: 1) network doesn't exist, 2) RPC is down for this network.`
          )
        })
      }

      if (this.#signAccountOpSigningPromise) {
        console.error('addUserRequest called with active #signAccountOpSigningPromise')
        await this.#signAccountOpSigningPromise
      }

      const account = this.accounts.accounts.find((x) => x.addr === meta.accountAddr)!
      const accountState = await this.accounts.getOrFetchAccountOnChainState(
        meta.accountAddr,
        meta.chainId
      )
      const network = this.networks.networks.find((n) => n.chainId === meta.chainId)!

      const accountOpAction = makeAccountOpAction({
        account,
        chainId: meta.chainId,
        nonce: accountState.nonce,
        userRequests: this.userRequests,
        actionsQueue: this.actions.actionsQueue
      })
      this.actions.addOrUpdateAction(accountOpAction, actionPosition, actionExecutionType)
      if (this.signAccountOp) {
        if (this.signAccountOp.fromActionId === accountOpAction.id) {
          this.signAccountOp.update({ calls: accountOpAction.accountOp.calls })
        }
      } else {
        // Even without an initialized SignAccountOpController or Screen, we should still update the portfolio and run the simulation.
        // It's necessary to continue operating with the token `amountPostSimulation` amount.
        this.updateSelectedAccountPortfolio(true, network)
      }
    } else {
      let actionType: 'dappRequest' | 'benzin' | 'signMessage' | 'switchAccount' = 'dappRequest'

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
      if (req.action.kind === 'switchAccount') actionType = 'switchAccount'
      if (req.action.kind === 'authorization-7702') actionType = 'signMessage'

      this.actions.addOrUpdateAction(
        {
          id,
          type: actionType,
          userRequest: req as UserRequest as never
        },
        actionPosition,
        actionExecutionType
      )
    }

    this.emitUpdate()
  }

  // @TODO allow this to remove multiple OR figure out a way to debounce re-estimations
  // first one sounds more reasonable
  // although the second one can't hurt and can help (or no debounce, just a one-at-a-time queue)
  removeUserRequest(
    id: UserRequest['id'],
    options?: {
      shouldRemoveSwapAndBridgeRoute: boolean
      shouldUpdateAccount?: boolean
      shouldOpenNextRequest?: boolean
    }
  ) {
    const {
      shouldRemoveSwapAndBridgeRoute = true,
      shouldUpdateAccount = true,
      shouldOpenNextRequest = true
    } = options || {}
    const req = this.userRequests.find((uReq) => uReq.id === id)
    if (!req) return

    // remove from the request queue
    this.userRequests.splice(this.userRequests.indexOf(req), 1)

    // update the pending stuff to be signed
    const { action, meta } = req
    if (action.kind === 'calls') {
      const network = this.networks.networks.find((net) => net.chainId === meta.chainId)!
      const account = this.accounts.accounts.find((x) => x.addr === meta.accountAddr)
      if (!account)
        throw new Error(
          `batchCallsFromUserRequests: tried to run for non-existent account ${meta.accountAddr}`
        )

      const accountOpIndex = this.actions.actionsQueue.findIndex(
        (a) => a.type === 'accountOp' && a.id === `${meta.accountAddr}-${meta.chainId}`
      )
      const accountOpAction = this.actions.actionsQueue[accountOpIndex] as
        | AccountOpAction
        | undefined
      // accountOp has just been rejected or broadcasted
      if (!accountOpAction) {
        if (shouldUpdateAccount) this.updateSelectedAccountPortfolio(true, network)

        if (this.swapAndBridge.activeRoutes.length && shouldRemoveSwapAndBridgeRoute) {
          this.swapAndBridge.removeActiveRoute(meta.activeRouteId)
        }
        this.emitUpdate()
        return
      }

      accountOpAction.accountOp.calls = this.#batchCallsFromUserRequests(
        meta.accountAddr,
        meta.chainId
      )
      if (accountOpAction.accountOp.calls.length) {
        this.actions.addOrUpdateAction(accountOpAction)

        if (this.signAccountOp && this.signAccountOp.fromActionId === accountOpAction.id) {
          this.signAccountOp.update({ calls: accountOpAction.accountOp.calls })
        }
      } else {
        if (this.signAccountOp && this.signAccountOp.fromActionId === accountOpAction.id) {
          this.destroySignAccOp()
        }
        this.actions.removeAction(`${meta.accountAddr}-${meta.chainId}`, shouldOpenNextRequest)
        if (shouldUpdateAccount) this.updateSelectedAccountPortfolio(true, network)
      }
      if (this.swapAndBridge.activeRoutes.length && shouldRemoveSwapAndBridgeRoute) {
        this.swapAndBridge.removeActiveRoute(meta.activeRouteId)
      }
    } else if (id === ACCOUNT_SWITCH_USER_REQUEST) {
      const requestsToAddOrRemove = this.userRequestWaitingAccountSwitch.filter(
        (r) => r.meta.accountAddr === this.selectedAccount.account!.addr
      )
      const isSelectedAccountSwitched =
        this.selectedAccount.account?.addr === (action as any).params!.switchToAccountAddr

      if (!isSelectedAccountSwitched) {
        this.actions.removeAction(id)
      } else {
        ;(async () => {
          // eslint-disable-next-line no-restricted-syntax
          for (const r of requestsToAddOrRemove) {
            this.userRequestWaitingAccountSwitch.splice(this.userRequests.indexOf(r), 1)
            await this.addUserRequest(r)
          }
        })()
      }
    } else {
      this.actions.removeAction(id, shouldOpenNextRequest)
    }
    this.emitUpdate()
  }

  async addNetwork(network: AddNetworkRequestParams) {
    await this.networks.addNetwork(network)

    await this.updateSelectedAccountPortfolio()
  }

  async removeNetworkData(chainId: bigint) {
    this.portfolio.removeNetworkData(chainId)
    this.defiPositions.removeNetworkData(chainId)
    this.accountPicker.removeNetworkData(chainId)
    // Don't remove user activity for now because removing networks
    // is no longer possible in the UI. Users can only disable networks
    // and it doesn't make sense to delete their activity
    // this.activity.removeNetworkData(chainId)
  }

  async resolveAccountOpAction(
    submittedAccountOp: SubmittedAccountOp,
    actionId: AccountOpAction['id'],
    isBasicAccountBroadcastingMultiple: boolean
  ) {
    const accountOpAction = this.actions.actionsQueue.find((a) => a.id === actionId)
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

    if (!isBasicAccountBroadcastingMultiple) {
      const benzinUserRequest: SignUserRequest = {
        id: new Date().getTime(),
        action: { kind: 'benzin' },
        meta
      }
      await this.addUserRequest(benzinUserRequest, 'first')
    }

    this.actions.removeAction(actionId)

    // handle wallet_sendCalls before activity.getConfirmedTxId as 1) it's faster
    // 2) the identifier is different
    // eslint-disable-next-line no-restricted-syntax
    for (const call of calls) {
      const walletSendCallsUserReq = this.userRequests.find(
        (r) => r.id === call.fromUserRequestId && r.meta.isWalletSendCalls
      )
      if (walletSendCallsUserReq) {
        walletSendCallsUserReq.dappPromise?.resolve({
          hash: getDappIdentifier(submittedAccountOp)
        })

        this.removeUserRequest(walletSendCallsUserReq.id, {
          shouldRemoveSwapAndBridgeRoute: false,
          // Since `resolveAccountOpAction` is invoked only when we broadcast a transaction,
          // we don't want to update the account portfolio immediately, as we would lose the simulation.
          // The simulation is required to calculate the pending badges (see: calculatePendingAmounts()).
          // Once the transaction is confirmed, delayed, or the user manually refreshes the portfolio,
          // the account will be updated automatically.
          shouldUpdateAccount: false
        })
      }
    }

    const dappHandlers = []
    // eslint-disable-next-line no-restricted-syntax
    for (const call of calls) {
      const uReq = this.userRequests.find((r) => r.id === call.fromUserRequestId)
      if (uReq) {
        if (uReq.dappPromise) {
          dappHandlers.push({
            promise: uReq.dappPromise,
            txnId: call.txnId
          })
        }

        this.removeUserRequest(uReq.id, {
          shouldRemoveSwapAndBridgeRoute: false,
          // Since `resolveAccountOpAction` is invoked only when we broadcast a transaction,
          // we don't want to update the account portfolio immediately, as we would lose the simulation.
          // The simulation is required to calculate the pending badges (see: calculatePendingAmounts()).
          // Once the transaction is confirmed, delayed, or the user manually refreshes the portfolio,
          // the account will be updated automatically.
          shouldUpdateAccount: false
        })
      }
    }

    this.resolveDappBroadcast(submittedAccountOp, dappHandlers)

    this.emitUpdate()
  }

  rejectAccountOpAction(
    err: string,
    actionId: AccountOpAction['id'],
    shouldOpenNextAction: boolean
  ) {
    const accountOpAction = this.actions.actionsQueue.find((a) => a.id === actionId)
    if (!accountOpAction) return

    const { accountOp, id } = accountOpAction as AccountOpAction

    if (this.signAccountOp && this.signAccountOp.fromActionId === id) {
      this.destroySignAccOp()
    }
    this.actions.removeAction(actionId, shouldOpenNextAction)
    // eslint-disable-next-line no-restricted-syntax
    for (const call of accountOp.calls) {
      if (call.fromUserRequestId) this.rejectUserRequest(err, call.fromUserRequestId)
    }

    this.emitUpdate()
  }

  onOneClickSwapClose() {
    const signAccountOp = this.swapAndBridge.signAccountOpController

    if (!signAccountOp) return

    // Remove the active route if it exists
    if (signAccountOp.accountOp.meta?.swapTxn) {
      this.swapAndBridge.removeActiveRoute(signAccountOp.accountOp.meta.swapTxn.activeRouteId)
    }

    this.swapAndBridge.unloadScreen('action-window', true)
    this.#abortHWSign(signAccountOp)

    const network = this.networks.networks.find(
      (n) => n.chainId === signAccountOp.accountOp.chainId
    )

    this.updateSelectedAccountPortfolio(true, network)
    this.emitUpdate()
  }

  async #handleTrezorCleanup() {
    try {
      await this.#windowManager.closePopupWithUrl('https://connect.trezor.io/9/popup.html')
    } catch (e) {
      console.error('Error while removing Trezor window', e)
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
  async #broadcastSignedAccountOp(
    signAccountOp: SignAccountOpController,
    type: SignAccountOpType,
    callId: string
  ) {
    if (this.statuses.signAndBroadcastAccountOp !== 'SIGNING') {
      this.throwBroadcastAccountOp({
        signAccountOp,
        message: 'Pending broadcast. Please try again in a bit.'
      })
      return
    }
    const accountOp = signAccountOp.accountOp
    const estimation = signAccountOp.estimation.estimation
    const actionId = signAccountOp.fromActionId
    const bundlerSwitcher = signAccountOp.bundlerSwitcher
    const contactSupportPrompt = 'Please try again or contact support if the problem persists.'

    if (
      !accountOp ||
      !estimation ||
      !actionId ||
      !accountOp.signingKeyAddr ||
      !accountOp.signingKeyType ||
      !accountOp.signature ||
      !bundlerSwitcher ||
      !accountOp.gasFeePayment
    ) {
      const message = `Missing mandatory transaction details. ${contactSupportPrompt}`
      return this.throwBroadcastAccountOp({ signAccountOp, message })
    }

    const provider = this.providers.providers[accountOp.chainId.toString()]
    const account = this.accounts.accounts.find((acc) => acc.addr === accountOp.accountAddr)
    const network = this.networks.networks.find((n) => n.chainId === accountOp.chainId)

    if (!provider) {
      const networkName = network?.name || `network with id ${accountOp.chainId}`
      const message = `Provider for ${networkName} not found. ${contactSupportPrompt}`
      return this.throwBroadcastAccountOp({ signAccountOp, message })
    }

    if (!account) {
      const addr = shortenAddress(accountOp.accountAddr, 13)
      const message = `Account with address ${addr} not found. ${contactSupportPrompt}`
      return this.throwBroadcastAccountOp({ signAccountOp, message })
    }

    if (!network) {
      const message = `Network with id ${accountOp.chainId} not found. ${contactSupportPrompt}`
      return this.throwBroadcastAccountOp({ signAccountOp, message })
    }

    this.statuses.signAndBroadcastAccountOp = 'BROADCASTING'
    await this.forceEmitUpdate()

    const accountState = await this.accounts.getOrFetchAccountOnChainState(
      accountOp.accountAddr,
      accountOp.chainId
    )
    const baseAcc = getBaseAccount(
      account,
      accountState,
      this.keystore.getAccountKeys(account),
      network
    )
    let transactionRes: {
      txnId?: string
      nonce: number
      identifiedBy: AccountOpIdentifiedBy
    } | null = null

    // broadcasting by EOA is quite the same:
    // 1) build a rawTxn 2) sign 3) broadcast
    // we have one handle, just a diff rawTxn for each case
    const rawTxnBroadcast = [
      BROADCAST_OPTIONS.bySelf,
      BROADCAST_OPTIONS.bySelf7702,
      BROADCAST_OPTIONS.byOtherEOA
    ]

    if (rawTxnBroadcast.includes(accountOp.gasFeePayment.broadcastOption)) {
      const multipleTxnsBroadcastRes = []
      const senderAddr = BROADCAST_OPTIONS.byOtherEOA
        ? accountOp.gasFeePayment.paidBy
        : accountOp.accountAddr
      const nonce = await provider.getTransactionCount(senderAddr).catch((e) => e)

      // @precaution
      if (nonce instanceof Error) {
        return this.throwBroadcastAccountOp({
          signAccountOp,
          message: 'RPC error. Please try again',
          accountState
        })
      }

      try {
        const feePayerKey = this.keystore.getFeePayerKey(accountOp)
        if (feePayerKey instanceof Error) {
          return this.throwBroadcastAccountOp({
            signAccountOp,
            message: feePayerKey.message,
            accountState
          })
        }
        this.feePayerKey = feePayerKey
        this.emitUpdate()

        const signer = await this.keystore.getSigner(feePayerKey.addr, feePayerKey.type)
        if (signer.init) {
          signer.init(this.#externalSignerControllers[feePayerKey.type])
        }

        const txnLength = baseAcc.shouldBroadcastCallsSeparately(accountOp)
          ? accountOp.calls.length
          : 1
        if (txnLength > 1) signAccountOp.update({ signedTransactionsCount: 0 })
        for (let i = 0; i < txnLength; i++) {
          const currentNonce = nonce + i
          const rawTxn = await buildRawTransaction(
            account,
            accountOp,
            accountState,
            provider,
            network,
            currentNonce,
            accountOp.gasFeePayment.broadcastOption,
            accountOp.calls[i]
          )
          const signedTxn = await signer.signRawTransaction(rawTxn)
          if (callId !== this.#signAndBroadcastCallId) {
            return
          }
          multipleTxnsBroadcastRes.push(await provider.broadcastTransaction(signedTxn))
          if (txnLength > 1) signAccountOp.update({ signedTransactionsCount: i + 1 })

          // send the txn to the relayer if it's an EOA sending for itself
          if (accountOp.gasFeePayment.broadcastOption !== BROADCAST_OPTIONS.byOtherEOA) {
            this.callRelayer(`/v2/eoaSubmitTxn/${accountOp.chainId}`, 'POST', {
              rawTxn: signedTxn
            }).catch((e: any) => {
              // eslint-disable-next-line no-console
              console.log('failed to record EOA txn to relayer')
              // eslint-disable-next-line no-console
              console.log(e)
            })
          }
        }
        if (callId !== this.#signAndBroadcastCallId) return
        transactionRes = {
          nonce,
          identifiedBy: {
            type: txnLength > 1 ? 'MultipleTxns' : 'Transaction',
            identifier: multipleTxnsBroadcastRes.map((res) => res.hash).join('-')
          },
          txnId:
            txnLength === 1 ? multipleTxnsBroadcastRes.map((res) => res.hash).join('-') : undefined
        }
      } catch (error: any) {
        if (this.#signAndBroadcastCallId !== callId) return
        // eslint-disable-next-line no-console
        console.error('Error broadcasting', error)
        // for multiple txn cases
        // if a batch of 5 txn is sent to Ledger for sign but the user reject
        // #3, #1 and #2 are already broadcast. Reduce the accountOp's call
        // to #1 and #2 and create a submittedAccountOp
        if (multipleTxnsBroadcastRes.length) {
          transactionRes = {
            nonce,
            identifiedBy: {
              type: 'MultipleTxns',
              identifier: multipleTxnsBroadcastRes.map((res) => res.hash).join('-')
            }
          }
        } else {
          return this.throwBroadcastAccountOp({ signAccountOp, error, accountState })
        }
      } finally {
        if (this.#signAndBroadcastCallId === callId) {
          signAccountOp.update({ signedTransactionsCount: null })
        }
      }
    }
    // Smart account, the ERC-4337 way
    else if (accountOp.gasFeePayment?.broadcastOption === BROADCAST_OPTIONS.byBundler) {
      const userOperation = accountOp.asUserOperation
      if (!userOperation) {
        const accAddr = shortenAddress(accountOp.accountAddr, 13)
        const message = `Trying to broadcast an ERC-4337 request but userOperation is not set for the account with address ${accAddr}`
        return this.throwBroadcastAccountOp({ signAccountOp, message, accountState })
      }

      // broadcast through bundler's service
      let userOperationHash
      const bundler = bundlerSwitcher.getBundler()
      try {
        userOperationHash = await bundler.broadcast(userOperation, network)
      } catch (e: any) {
        let retryMsg

        // if the signAccountOp is still active (it should be)
        // try to switch the bundler and ask the user to try again
        // TODO: explore more error case where we switch the bundler
        if (signAccountOp) {
          const decodedError = bundler.decodeBundlerError(e)
          const humanReadable = getHumanReadableBroadcastError(decodedError)
          const switcher = signAccountOp.bundlerSwitcher
          signAccountOp.updateStatus(SigningStatus.ReadyToSign)

          if (switcher.canSwitch(account, humanReadable)) {
            switcher.switch()
            signAccountOp.simulate()
            signAccountOp.gasPrice.fetch()
            retryMsg = 'Broadcast failed because bundler was down. Please try again'
          }
        }

        return this.throwBroadcastAccountOp({
          signAccountOp,
          error: e,
          accountState,
          provider,
          network,
          message: retryMsg
        })
      }
      if (!userOperationHash) {
        return this.throwBroadcastAccountOp({
          signAccountOp,
          message: 'Bundler broadcast failed. Please try broadcasting by an EOA or contact support.'
        })
      }

      transactionRes = {
        nonce: Number(userOperation.nonce),
        identifiedBy: {
          type: 'UserOperation',
          identifier: userOperationHash,
          bundler: bundler.getName()
        }
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
        const additionalRelayerNetwork = relayerAdditionalNetworks.find(
          (net) => net.chainId === network.chainId
        )
        const relayerChainId = additionalRelayerNetwork
          ? additionalRelayerNetwork.chainId
          : accountOp.chainId
        const response = await this.callRelayer(
          `/identity/${accountOp.accountAddr}/${relayerChainId}/submit`,
          'POST',
          body
        )
        if (!response.success) throw new Error(response.message)

        transactionRes = {
          txnId: response.txId,
          nonce: Number(accountOp.nonce),
          identifiedBy: {
            type: 'Relayer',
            identifier: response.id
          }
        }
      } catch (error: any) {
        return this.throwBroadcastAccountOp({ signAccountOp, error, accountState, isRelayer: true })
      }
    }

    if (this.#signAndBroadcastCallId !== callId) return

    if (!transactionRes)
      return this.throwBroadcastAccountOp({
        signAccountOp,
        message: 'No transaction response received after being broadcasted.'
      })

    this.portfolio.markSimulationAsBroadcasted(account.addr, network.chainId)

    const submittedAccountOp: SubmittedAccountOp = {
      ...accountOp,
      status: AccountOpStatus.BroadcastedButNotConfirmed,
      txnId: transactionRes.txnId,
      nonce: BigInt(transactionRes.nonce),
      identifiedBy: transactionRes.identifiedBy,
      timestamp: new Date().getTime(),
      isSingletonDeploy: !!accountOp.calls.find(
        (call) => call.to && getAddress(call.to) === SINGLETON
      )
    }

    // add the txnIds from each transaction to each Call from the accountOp
    // if identifiedBy is MultipleTxns
    const isBasicAccountBroadcastingMultiple = transactionRes.identifiedBy.type === 'MultipleTxns'
    if (isBasicAccountBroadcastingMultiple) {
      const txnIds = transactionRes.identifiedBy.identifier.split('-')
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
      submittedAccountOp.calls = calls

      // Handle the calls that weren't signed
      const rejectedCalls = accountOp.calls.filter((call) =>
        submittedAccountOp.calls.every((c) => c.id !== call.id)
      )
      const rejectedSwapActiveRouteIds = rejectedCalls.map((call) => {
        const userRequest = this.userRequests.find((r) => r.id === call.fromUserRequestId)

        return userRequest?.meta.activeRouteId
      })

      rejectedSwapActiveRouteIds.forEach((routeId) => {
        this.removeActiveRoute(routeId)
      })

      if (rejectedCalls.length) {
        // remove the user requests that were rejected
        rejectedCalls.forEach((call) => {
          if (!call.fromUserRequestId) return
          this.rejectUserRequest('Transaction rejected by the bundler', call.fromUserRequestId)
        })
      }
    }

    this.swapAndBridge.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(submittedAccountOp)
    await this.activity.addAccountOp(submittedAccountOp)

    // resolve dapp requests, open benzin and etc only if the main sign accountOp
    if (type === SIGN_ACCOUNT_OP_MAIN) {
      await this.resolveAccountOpAction(
        submittedAccountOp,
        actionId,
        isBasicAccountBroadcastingMultiple
      )
    }
    // TODO<Bobby>: make a new SwapAndBridgeFormStatus "Broadcast" and
    // visualize the success page on the FE instead of resetting the form
    if (type === SIGN_ACCOUNT_OP_SWAP) {
      this.swapAndBridge.resetForm()
    }

    await this.#notificationManager.create({
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

    // reset the fee payer key
    this.feePayerKey = null
    return Promise.resolve()
  }

  // ! IMPORTANT !
  // Banners that depend on async data from sub-controllers should be implemented
  // in the sub-controllers themselves. This is because updates in the sub-controllers
  // will not trigger emitUpdate in the MainController, therefore the banners will
  // remain the same until a subsequent update in the MainController.
  get banners(): Banner[] {
    if (!this.selectedAccount.account || !this.networks.isInitialized) return []

    const activeSwapAndBridgeRoutesForSelectedAccount = getActiveRoutesForAccount(
      this.selectedAccount.account.addr,
      this.swapAndBridge.activeRoutes
    )
    const swapAndBridgeRoutesPendingSignature = activeSwapAndBridgeRoutesForSelectedAccount.filter(
      (r) => r.routeStatus === 'ready'
    )

    return getAccountOpBanners({
      accountOpActionsByNetwork: getAccountOpActionsByNetwork(
        this.selectedAccount.account.addr,
        this.actions.actionsQueue
      ),
      selectedAccount: this.selectedAccount.account.addr,
      accounts: this.accounts.accounts,
      networks: this.networks.networks,
      swapAndBridgeRoutesPendingSignature
    })
  }

  // Technically this is an anti-pattern, but it's the only way to
  // test the error handling in the method.
  protected throwBroadcastAccountOp({
    signAccountOp,
    message: humanReadableMessage,
    error: _err,
    accountState,
    isRelayer = false,
    provider = undefined,
    network = undefined
  }: {
    signAccountOp: SignAccountOpController
    message?: string
    error?: Error
    accountState?: AccountOnchainState
    isRelayer?: boolean
    provider?: RPCProvider
    network?: Network
  }) {
    const originalMessage = _err?.message
    let message = humanReadableMessage
    let isReplacementFeeLow = false

    this.statuses.signAndBroadcastAccountOp = 'ERROR'
    this.forceEmitUpdate()

    if (originalMessage) {
      if (originalMessage.includes('replacement fee too low')) {
        message =
          'Replacement fee is insufficient. Fees have been automatically adjusted so please try submitting your transaction again.'
        isReplacementFeeLow = true
        if (signAccountOp) {
          signAccountOp.simulate(false)
        }
      } else if (originalMessage.includes('INSUFFICIENT_PRIVILEGE')) {
        message = accountState?.isV2
          ? 'Broadcast failed because of a pending transaction. Please try again'
          : 'Signer key not supported on this network'
      } else if (originalMessage.includes('underpriced')) {
        message =
          'Transaction fee underpriced. Please select a higher transaction speed and try again'
        if (signAccountOp) {
          signAccountOp.gasPrice.fetch()
          signAccountOp.simulate(false)
        }
      } else if (originalMessage.includes('Failed to fetch') && isRelayer) {
        message =
          'Currently, the Ambire relayer seems to be down. Please try again a few moments later or broadcast with a Basic Account'
      } else if (originalMessage.includes('user nonce') && isRelayer) {
        if (this.signAccountOp) {
          this.accounts
            .updateAccountState(this.signAccountOp.accountOp.accountAddr, 'pending', [
              this.signAccountOp.accountOp.chainId
            ])
            .then(() => this.signAccountOp?.simulate())
            .catch((e) => e)
        }
      }
    }

    if (!message) {
      message = getHumanReadableBroadcastError(_err || new Error('')).message

      // if the message states that the paymaster doesn't have sufficient amount,
      // add it to the failedPaymasters to disable it until a top-up is made
      if (message.includes(insufficientPaymasterFunds) && provider && network) {
        failedPaymasters.addInsufficientFunds(provider, network).then(() => {
          if (signAccountOp) {
            signAccountOp.simulate(false)
          }
        })
      }
      if (message.includes('the selected fee is too low')) {
        signAccountOp.gasPrice.fetch()
      }
    }

    // To enable another try for signing in case of broadcast fail
    // broadcast is called in the FE only after successful signing
    signAccountOp?.updateStatus(SigningStatus.ReadyToSign, isReplacementFeeLow)
    this.feePayerKey = null

    // remove the active route on broadcast failure
    if (signAccountOp?.accountOp.meta?.swapTxn) {
      this.swapAndBridge.removeActiveRoute(signAccountOp.accountOp.meta.swapTxn.activeRouteId)
    }

    throw new EmittableError({ level: 'major', message, error: _err || new Error(message) })
  }

  get isSignRequestStillActive(): boolean {
    if (!this.signAccountOp) return false

    return !!this.actions.actionsQueue.find((a) => a.id === this.signAccountOp!.fromActionId)
  }

  // includes the getters in the stringified instance
  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      banners: this.banners,
      isSignRequestStillActive: this.isSignRequestStillActive
    }
  }
}
