/* eslint-disable @typescript-eslint/no-floating-promises */
import { ethErrors } from 'eth-rpc-errors'
/* eslint-disable @typescript-eslint/brace-style */
import { getAddress, getBigInt, Interface, isAddress } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import EmittableError from '../../classes/EmittableError'
import { AMBIRE_ACCOUNT_FACTORY, SINGLETON } from '../../consts/deploy'
import {
  BIP44_LEDGER_DERIVATION_TEMPLATE,
  BIP44_STANDARD_DERIVATION_TEMPLATE
} from '../../consts/derivation'
import {
  Account,
  AccountId,
  AccountOnchainState,
  AccountWithNetworkMeta
} from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { DappProviderRequest } from '../../interfaces/dapp'
import { Fetch } from '../../interfaces/fetch'
import {
  ExternalSignerControllers,
  Key,
  KeystoreSignerType,
  TxnRequest
} from '../../interfaces/keystore'
import { AddNetworkRequestParams, Network, NetworkId } from '../../interfaces/network'
import { NotificationManager } from '../../interfaces/notification'
import { Storage } from '../../interfaces/storage'
import { Calls, DappUserRequest, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import { isSmartAccount } from '../../libs/account/account'
import { AccountOp, AccountOpStatus, getSignableCalls } from '../../libs/accountOp/accountOp'
import { AccountOpIdentifiedBy, SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { Call } from '../../libs/accountOp/types'
import {
  dappRequestMethodToActionKind,
  getAccountOpActionsByNetwork,
  getAccountOpFromAction
} from '../../libs/actions/actions'
import { getAccountOpBanners } from '../../libs/banners/banners'
import { estimate } from '../../libs/estimate/estimate'
import { BundlerGasPrice, EstimateResult } from '../../libs/estimate/interfaces'
import { GasRecommendation, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { humanizeAccountOp } from '../../libs/humanizer'
import { KeyIterator } from '../../libs/keyIterator/keyIterator'
import {
  getAccountOpsForSimulation,
  makeBasicAccountOpAction,
  makeSmartAccountOpAction
} from '../../libs/main/main'
import { GetOptions, TokenResult } from '../../libs/portfolio/interfaces'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { parse } from '../../libs/richJson/richJson'
import {
  adjustEntryPointAuthorization,
  getEntryPointAuthorization
} from '../../libs/signMessage/signMessage'
import { debugTraceCall } from '../../libs/tracer/debugTraceCall'
import { buildTransferUserRequest } from '../../libs/transfer/userRequest'
import {
  ENTRY_POINT_AUTHORIZATION_REQUEST_ID,
  isErc4337Broadcast,
  shouldAskForEntryPointAuthorization
} from '../../libs/userOperation/userOperation'
import bundler from '../../services/bundlers'
import { Bundler } from '../../services/bundlers/bundler'
import { getIsViewOnly } from '../../utils/accounts'
import shortenAddress from '../../utils/shortenAddress'
import wait from '../../utils/wait'
import { AccountAdderController } from '../accountAdder/accountAdder'
import { AccountsController } from '../accounts/accounts'
import { AccountOpAction, ActionsController, SignMessageAction } from '../actions/actions'
import { ActivityController } from '../activity/activity'
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
/* eslint-disable no-underscore-dangle */
import { SignAccountOpController, SigningStatus } from '../signAccountOp/signAccountOp'
import { SignMessageController } from '../signMessage/signMessage'

const STATUS_WRAPPED_METHODS = {
  onAccountAdderSuccess: 'INITIAL',
  signAccountOp: 'INITIAL',
  broadcastSignedAccountOp: 'INITIAL',
  removeAccount: 'INITIAL',
  handleAccountAdderInitLedger: 'INITIAL',
  handleAccountAdderInitLattice: 'INITIAL',
  importSmartAccountFromDefaultSeed: 'INITIAL'
} as const

export class MainController extends EventEmitter {
  #storage: Storage

  fetch: Fetch

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  callRelayer: Function

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

  signMessage: SignMessageController

  signAccountOp: SignAccountOpController | null = null

  signAccOpInitError: string | null = null

  activity: ActivityController

  addressBook: AddressBookController

  domains: DomainsController

  accounts: AccountsController

  userRequests: UserRequest[] = []

  // network => GasRecommendation[]
  gasPrices: { [key: string]: GasRecommendation[] } = {}

  // network => BundlerGasPrice
  bundlerGasPrices: { [key: string]: BundlerGasPrice } = {}

  accountOpsToBeConfirmed: { [key: string]: { [key: string]: AccountOp } } = {}

  // TODO: Temporary solution to expose the fee payer key during Account Op broadcast.
  feePayerKey: Key | null = null

  lastUpdate: Date = new Date()

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  #windowManager: WindowManager

  #notificationManager: NotificationManager

  constructor({
    storage,
    fetch,
    relayerUrl,
    velcroUrl,
    keystoreSigners,
    externalSignerControllers,
    windowManager,
    notificationManager
  }: {
    storage: Storage
    fetch: Fetch
    relayerUrl: string
    velcroUrl: string
    keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>
    externalSignerControllers: ExternalSignerControllers
    windowManager: WindowManager
    notificationManager: NotificationManager
  }) {
    super()
    this.#storage = storage
    this.fetch = fetch
    this.#windowManager = windowManager
    this.#notificationManager = notificationManager

    this.invite = new InviteController({ relayerUrl, fetch, storage: this.#storage })
    this.keystore = new KeystoreController(this.#storage, keystoreSigners)
    this.#externalSignerControllers = externalSignerControllers
    this.networks = new NetworksController(
      this.#storage,
      this.fetch,
      async (network: Network) => {
        this.providers.setProvider(network)
        await this.accounts.updateAccountStates('latest', [network.id])
        await this.updateSelectedAccountPortfolio(true)
      },
      (networkId: NetworkId) => {
        this.providers.removeProvider(networkId)
      }
    )
    this.providers = new ProvidersController(this.networks)
    this.accounts = new AccountsController(
      this.#storage,
      this.providers,
      this.networks,
      async (toAccountAddr: string) => {
        this.activity.init()
        // TODO: We agreed to always fetch the latest and pending states.
        // To achieve this, we need to refactor how we use forceUpdate to obtain pending state updates.
        await this.updateSelectedAccountPortfolio(true)
        // forceEmitUpdate to update the getters in the FE state of the ctrl
        await this.forceEmitUpdate()
        await this.actions.forceEmitUpdate()
        await this.addressBook.forceEmitUpdate()
        this.dapps.broadcastDappSessionEvent('accountsChanged', [toAccountAddr])
      },
      this.providers.updateProviderIsWorking.bind(this.providers)
    )
    this.portfolio = new PortfolioController(
      this.#storage,
      this.fetch,
      this.providers,
      this.networks,
      this.accounts,
      relayerUrl,
      velcroUrl
    )
    this.#initialLoadPromise = this.#load()
    this.emailVault = new EmailVaultController(this.#storage, this.fetch, relayerUrl, this.keystore)
    this.accountAdder = new AccountAdderController({
      accounts: this.accounts,
      keystore: this.keystore,
      networks: this.networks,
      providers: this.providers,
      relayerUrl,
      fetch: this.fetch
    })
    this.addressBook = new AddressBookController(this.#storage, this.accounts)
    this.signMessage = new SignMessageController(
      this.keystore,
      this.providers,
      this.networks,
      this.accounts,
      this.#externalSignerControllers,
      this.#storage,
      this.fetch
    )
    this.dapps = new DappsController(this.#storage)
    this.actions = new ActionsController({
      accounts: this.accounts,
      windowManager,
      notificationManager,
      onActionWindowClose: () => {
        const userRequestsToRejectOnWindowClose = this.userRequests.filter(
          (r) => r.action.kind !== 'calls'
        )
        userRequestsToRejectOnWindowClose.forEach((r) =>
          r.dappPromise?.reject(ethErrors.provider.userRejectedRequest())
        )
        this.userRequests = this.userRequests.filter((r) => r.action.kind === 'calls')
        this.emitUpdate()
      }
    })
    this.callRelayer = relayerCall.bind({ url: relayerUrl, fetch: this.fetch })
    this.activity = new ActivityController(
      this.#storage,
      this.fetch,
      this.callRelayer,
      this.accounts,
      this.providers,
      this.networks,
      async (network: Network) => {
        await this.setContractsDeployedToTrueIfDeployed(network)
      }
    )
    this.domains = new DomainsController(this.providers.providers, this.fetch)
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
    // TODO: We agreed to always fetch the latest and pending states.
    // To achieve this, we need to refactor how we use forceUpdate to obtain pending state updates.
    this.updateSelectedAccountPortfolio(true)

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
          await this.accounts.addAccounts(this.accountAdder.readyToAddAccounts)

          // Then add keys, because some of the next steps could have validation
          // if keys exists. Should be separate (not combined in Promise.all,
          // since firing multiple keystore actions is not possible
          // (the #wrapKeystoreAction listens for the first one to finish and
          // skips the parallel one, if one is requested).
          await this.keystore.addKeys(this.accountAdder.readyToAddKeys.internal)
          await this.keystore.addKeysExternallyStored(this.accountAdder.readyToAddKeys.external)
        },
        true
      )
    }
    this.accountAdder.onUpdate(onAccountAdderSuccess)

    this.isReady = true
    this.emitUpdate()
  }

  async importSmartAccountFromDefaultSeed(seed?: string) {
    await this.withStatus(
      'importSmartAccountFromDefaultSeed',
      async () => {
        if (this.accountAdder.isInitialized) this.accountAdder.reset()
        if (seed && !this.keystore.hasKeystoreDefaultSeed) {
          await this.keystore.addSeed(seed)
        }

        const defaultSeed = await this.keystore.getDefaultSeed()

        if (!defaultSeed) {
          throw new EmittableError({
            message:
              'Failed to retrieve default seed phrase from keystore. Please try again or contact Ambire support if the issue persists.',
            level: 'major',
            error: new Error('failed to retrieve default seed phrase from keystore')
          })
        }

        const keyIterator = new KeyIterator(defaultSeed)
        this.accountAdder.init({
          keyIterator,
          hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE,
          pageSize: 1,
          shouldGetAccountsUsedOnNetworks: false,
          shouldSearchForLinkedAccounts: false
        })

        let currentPage: number = 1
        let isAccountAlreadyAdded: boolean
        let nextSmartAccount: AccountWithNetworkMeta | undefined

        const findNextSmartAccount = async () => {
          do {
            // eslint-disable-next-line no-await-in-loop
            await this.accountAdder.setPage({ page: currentPage })

            nextSmartAccount = this.accountAdder.accountsOnPage.find(
              ({ isLinked, account }) => !isLinked && isSmartAccount(account)
            )?.account

            if (!nextSmartAccount) break

            isAccountAlreadyAdded = !!this.accounts.accounts.find(
              // eslint-disable-next-line @typescript-eslint/no-loop-func
              (a) => a.addr === nextSmartAccount!.addr
            )

            currentPage++
          } while (isAccountAlreadyAdded)
        }

        await findNextSmartAccount()

        if (!nextSmartAccount) {
          throw new EmittableError({
            message:
              'Internal error while looking for account to add. Please start the process all over again and if the issue persists contact Ambire support.',
            level: 'major',
            error: new Error('Internal error: Failed to find a smart account to add')
          })
        }

        this.accountAdder.selectAccount(nextSmartAccount)

        const readyToAddKeys = this.accountAdder.retrieveInternalKeysOfSelectedAccounts()

        await this.accountAdder.addAccounts(this.accountAdder.selectedAccounts, {
          internal: readyToAddKeys,
          external: []
        })
      },
      true
    )
  }

  initSignAccOp(actionId: AccountOpAction['id']): null | void {
    const accountOp = getAccountOpFromAction(actionId, this.actions.actionsQueue)
    if (!accountOp) {
      this.signAccOpInitError =
        'We cannot initiate the signing process because no transaction has been found for the specified account and network.'
      return null
    }

    const account = this.accounts.accounts?.find((acc) => acc.addr === accountOp.accountAddr)
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

    // on init, set the accountOp nonce to the latest one we know
    // it could happen that the user inits a userRequest with an old
    // accountState and therefore caching the old nonce in the accountOp.
    // we make sure the latest nonce is set when initing signAccountOp
    const state = this.accounts.accountStates?.[accountOp.accountAddr]?.[accountOp.networkId]
    if (state) accountOp.nonce = state.nonce

    this.signAccOpInitError = null

    this.signAccountOp = new SignAccountOpController(
      this.accounts,
      this.keystore,
      this.portfolio,
      this.providers,
      this.#externalSignerControllers,
      account,
      network,
      actionId,
      accountOp,
      this.#storage,
      this.fetch,
      this.callRelayer,
      () => {
        this.estimateSignAccountOp()
      }
    )

    this.emitUpdate()

    this.updateSignAccountOpGasPrice()
    this.estimateSignAccountOp()
  }

  async handleSignAndBroadcastAccountOp() {
    await this.withStatus(
      'signAccountOp',
      async () => {
        const wasAlreadySigned = this.signAccountOp?.status?.type === SigningStatus.Done
        if (wasAlreadySigned) return Promise.resolve()

        if (!this.signAccountOp) {
          const message =
            'The signing process was not initialized as expected. Please try again later or contact Ambire support if the issue persists.'
          const error = new Error('SignAccountOp is not initialized')
          this.emitError({ level: 'major', message, error })
          return Promise.reject(error)
        }

        return this.signAccountOp.sign()
      },
      true
    )

    // Error handling on the prev step will notify the user, it's fine to return here
    if (this.signAccountOp?.status?.type !== SigningStatus.Done) return

    return this.withStatus(
      'broadcastSignedAccountOp',
      async () => this.#broadcastSignedAccountOp(),
      true
    )
  }

  destroySignAccOp() {
    if (!this.signAccountOp) return

    this.feePayerKey = null
    this.signAccountOp = null
    this.signAccOpInitError = null

    // NOTE: no need to update the portfolio here as an update is
    // fired upon removeUserRequest

    this.emitUpdate()
  }

  async traceCall(estimation: EstimateResult) {
    const accountOp = this.signAccountOp?.accountOp
    if (!accountOp) return

    const network = this.networks.networks.find((net) => net.id === accountOp?.networkId)
    if (!network) return

    const account = this.accounts.accounts.find((acc) => acc.addr === accountOp.accountAddr)!
    const state = this.accounts.accountStates[accountOp.accountAddr][accountOp.networkId]
    const provider = this.providers.providers[network.id]
    const gasPrice = this.gasPrices[network.id]
    const { tokens, nfts } = await debugTraceCall(
      account,
      accountOp,
      provider,
      state,
      estimation.gasUsed,
      gasPrice,
      !network.rpcNoStateOverride
    )
    const learnedNewTokens = this.portfolio.addTokensToBeLearned(tokens, network.id)
    const learnedNewNfts = await this.portfolio.learnNfts(nfts, network.id)
    // update the portfolio only if new tokens were found through tracing
    if (learnedNewTokens || learnedNewNfts) {
      this.portfolio.updateSelectedAccount(
        accountOp.accountAddr,
        network,
        getAccountOpsForSimulation(account, this.actions.visibleActionsQueue, network, accountOp),
        { forceUpdate: true }
      )
    }
  }

  async handleSignMessage() {
    const accountAddr = this.signMessage.messageToSign?.accountAddr
    const networkId = this.signMessage.messageToSign?.networkId

    // Could (rarely) happen if not even a single account state is fetched yet
    const shouldForceUpdateAndWaitForAccountState =
      accountAddr && networkId && !this.accounts.accountStates?.[accountAddr]?.[networkId]
    if (shouldForceUpdateAndWaitForAccountState)
      await this.accounts.updateAccountState(accountAddr, 'latest', [networkId])

    const isAccountStateStillMissing =
      !accountAddr || !networkId || !this.accounts.accountStates?.[accountAddr]?.[networkId]
    if (isAccountStateStillMissing) {
      const message =
        'Unable to sign the message. During the preparation step, required account data failed to get received. Please try again later or contact Ambire support.'
      const error = new Error(
        `The account state of ${accountAddr} is missing for the network with id ${networkId}.`
      )
      return this.emitError({ level: 'major', message, error })
    }

    await this.signMessage.sign()

    const signedMessage = this.signMessage.signedMessage
    // Error handling on the prev step will notify the user, it's fine to return here
    if (!signedMessage) return

    if (signedMessage.fromActionId === ENTRY_POINT_AUTHORIZATION_REQUEST_ID) {
      const accountOpAction = makeSmartAccountOpAction({
        account: this.accounts.accounts.filter((a) => a.addr === signedMessage.accountAddr)[0],
        networkId: signedMessage.networkId,
        nonce:
          this.accounts.accountStates[signedMessage.accountAddr][signedMessage.networkId].nonce,
        userRequests: this.userRequests,
        actionsQueue: this.actions.actionsQueue
      })
      if (!accountOpAction.accountOp.meta) accountOpAction.accountOp.meta = {}
      accountOpAction.accountOp.meta.entryPointAuthorization = adjustEntryPointAuthorization(
        signedMessage.signature as string
      )

      this.actions.addOrUpdateAction(accountOpAction, true)
    }

    await this.activity.addSignedMessage(signedMessage, signedMessage.accountAddr)
    await this.resolveUserRequest({ hash: signedMessage.signature }, signedMessage.fromActionId)

    await this.#notificationManager.create({
      title: 'Done!',
      message: 'The Message was successfully signed.'
    })
  }

  async #handleAccountAdderInitLedger(
    LedgerKeyIterator: any // TODO: KeyIterator type mismatch
  ) {
    if (this.accountAdder.isInitialized) this.accountAdder.reset()

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
      this.accountAdder.init({ keyIterator, hdPathTemplate })

      return await this.accountAdder.setPage({ page: 1 })
    } catch (error: any) {
      const message = error?.message || 'Could not unlock the Ledger device. Please try again.'
      throw new EmittableError({ message, level: 'major', error })
    }
  }

  async handleAccountAdderInitLedger(LedgerKeyIterator: any /* TODO: KeyIterator type mismatch */) {
    await this.withStatus('handleAccountAdderInitLedger', async () =>
      this.#handleAccountAdderInitLedger(LedgerKeyIterator)
    )
  }

  async #handleAccountAdderInitLattice(
    LatticeKeyIterator: any /* TODO: KeyIterator type mismatch */
  ) {
    if (this.accountAdder.isInitialized) this.accountAdder.reset()

    try {
      const latticeCtrl = this.#externalSignerControllers.lattice
      if (!latticeCtrl) {
        const message =
          'Could not initialize connection with your Lattice1 device. Please try again later or contact Ambire support.'
        throw new EmittableError({ message, level: 'major', error: new Error(message) })
      }

      const hdPathTemplate = BIP44_STANDARD_DERIVATION_TEMPLATE
      await latticeCtrl.unlock(hdPathTemplate, undefined, true)

      const { walletSDK } = latticeCtrl
      this.accountAdder.init({
        keyIterator: new LatticeKeyIterator({ walletSDK }),
        hdPathTemplate
      })

      return await this.accountAdder.setPage({ page: 1 })
    } catch (error: any) {
      const message = error?.message || 'Could not unlock the Lattice1 device. Please try again.'
      throw new EmittableError({ message, level: 'major', error })
    }
  }

  async handleAccountAdderInitLattice(
    LatticeKeyIterator: any /* TODO: KeyIterator type mismatch */
  ) {
    await this.withStatus('handleAccountAdderInitLattice', async () =>
      this.#handleAccountAdderInitLattice(LatticeKeyIterator)
    )
  }

  async updateAccountsOpsStatuses() {
    await this.#initialLoadPromise

    const { shouldEmitUpdate, shouldUpdatePortfolio } =
      await this.activity.updateAccountsOpsStatuses()

    if (shouldEmitUpdate) {
      this.emitUpdate()

      if (shouldUpdatePortfolio) {
        this.updateSelectedAccountPortfolio(true)
      }
    }
  }

  // call this function after a call to the singleton has been made
  // it will check if the factory has been deployed and update the network settings if it has been
  async setContractsDeployedToTrueIfDeployed(network: Network) {
    await this.#initialLoadPromise
    if (network.areContractsDeployed) return

    const provider = this.providers.providers[network.id]
    if (!provider) return

    const factoryCode = await provider.getCode(AMBIRE_ACCOUNT_FACTORY)
    if (factoryCode === '0x') return
    await this.networks.updateNetwork({ areContractsDeployed: true }, network.id)
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

  async removeAccount(address: Account['addr']) {
    await this.withStatus('removeAccount', async () => {
      try {
        this.#removeAccountKeyData(address)
        // Remove account data from sub-controllers
        await this.accounts.removeAccountData(address)
        this.portfolio.removeAccountData(address)
        this.activity.removeAccountData(address)
        this.actions.removeAccountData(address)
        this.signMessage.removeAccountData(address)

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
    })
  }

  async #ensureAccountInfo(accountAddr: AccountId, networkId: NetworkId) {
    await this.#initialLoadPromise
    // Initial sanity check: does this account even exist?
    if (!this.accounts.accounts.find((x) => x.addr === accountAddr)) {
      this.signAccOpInitError = `Account ${accountAddr} does not exist`
      return
    }
    // If this still didn't work, re-load
    if (!this.accounts.accountStates[accountAddr]?.[networkId])
      await this.accounts.updateAccountState(accountAddr, 'pending', [networkId])
    // If this still didn't work, throw error: this prob means that we're calling for a non-existent acc/network
    if (!this.accounts.accountStates[accountAddr]?.[networkId])
      this.signAccOpInitError = `Failed to retrieve account info for ${networkId}, because of one of the following reasons: 1) network doesn't exist, 2) RPC is down for this network`
  }

  #batchCallsFromUserRequests(accountAddr: AccountId, networkId: NetworkId): Call[] {
    // Note: we use reduce instead of filter/map so that the compiler can deduce that we're checking .kind
    return (this.userRequests.filter((r) => r.action.kind === 'calls') as SignUserRequest[]).reduce(
      (uCalls: Call[], req) => {
        if (req.meta.networkId === networkId && req.meta.accountAddr === accountAddr) {
          const { calls } = req.action as Calls
          calls.map((call) => uCalls.push({ ...call, fromUserRequestId: req.id }))
        }
        return uCalls
      },
      []
    )
  }

  async reloadSelectedAccount() {
    if (!this.accounts.selectedAccount) return

    const isUpdatingAccount = this.accounts.statuses.updateAccountState !== 'INITIAL'

    await Promise.all([
      // When we trigger `reloadSelectedAccount` (for instance, from Dashboard -> Refresh balance icon),
      // it's very likely that the account state is already in the process of being updated.
      // If we try to run the same action, `withStatus` validation will throw an error.
      // So, we perform this safety check to prevent the error.
      // However, even if we don't trigger an update here, it's not a big problem,
      // as the account state will be updated anyway, and its update will be very recent.
      !isUpdatingAccount
        ? this.accounts.updateAccountState(this.accounts.selectedAccount, 'pending')
        : Promise.resolve(),
      // `updateSelectedAccountPortfolio` doesn't rely on `withStatus` validation internally,
      // as the PortfolioController already exposes flags that are highly sufficient for the UX.
      // Additionally, if we trigger the portfolio update twice (i.e., running a long-living interval + force update from the Dashboard),
      // there won't be any error thrown, as all portfolio updates are queued and they don't use the `withStatus` helper.
      this.updateSelectedAccountPortfolio(true)
    ])
  }

  // eslint-disable-next-line default-param-last
  async updateSelectedAccountPortfolio(forceUpdate: boolean = true, network?: Network) {
    await this.#initialLoadPromise
    if (!this.accounts.selectedAccount) return

    const account = this.accounts.accounts.find((a) => a.addr === this.accounts.selectedAccount)
    const signAccountOpNetworkId = this.signAccountOp?.accountOp.networkId
    const networkData =
      network || this.networks.networks.find((n) => n.id === signAccountOpNetworkId)

    const accountOpsToBeSimulatedByNetwork = getAccountOpsForSimulation(
      account!,
      this.actions.visibleActionsQueue,
      networkData,
      this.signAccountOp?.accountOp
    )

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.portfolio.updateSelectedAccount(
      this.accounts.selectedAccount,
      network,
      accountOpsToBeSimulatedByNetwork,
      { forceUpdate }
    )
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
    let userRequest = null
    let withPriority = false
    const kind = dappRequestMethodToActionKind(request.method)
    const dapp = this.dapps.getDapp(request.origin)

    if (kind === 'calls') {
      if (!this.accounts.selectedAccount) throw ethErrors.rpc.internal()

      const isWalletSendCalls = !!request.params[0].calls
      const calls: Calls['calls'] = isWalletSendCalls
        ? request.params[0].calls
        : [request.params[0]]
      const accountAddr = getAddress(request.params[0].from)
      const account = this.accounts.accounts.find((a) => a.addr === accountAddr)

      if (!account) {
        throw ethErrors.provider.unauthorized('Transaction failed - unknown account address')
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
          kind,
          calls: calls.map((call) => ({
            to: call.to,
            data: call.data || '0x',
            value: call.value ? getBigInt(call.value) : 0n
          }))
        },
        meta: { isSignAction: true, accountAddr, networkId: network.id },
        dappPromise
      } as SignUserRequest
      if (!account.creation) {
        const otherUserRequestFromSameDapp = this.userRequests.find(
          (r) => r.dappPromise?.session?.origin === dappPromise?.session?.origin
        )

        if (!otherUserRequestFromSameDapp && !!dappPromise?.session?.origin) {
          withPriority = true
        }
      }
    } else if (kind === 'message') {
      if (!this.accounts.selectedAccount) throw ethErrors.rpc.internal()

      const msg = request.params
      if (!msg) {
        throw ethErrors.rpc.invalidRequest('No msg request to sign')
      }
      const msgAddress = getAddress(msg?.[1])
      // TODO: if address is in this.accounts in theory the user should be able to sign
      // e.g. if an acc from the wallet is used as a signer of another wallet
      if (msgAddress !== this.accounts.selectedAccount) {
        dappPromise.reject(
          ethErrors.provider.userRejectedRequest(
            // if updating, check https://github.com/AmbireTech/ambire-wallet/pull/1627
            'the dApp is trying to sign using an address different from the currently selected account. Try re-connecting.'
          )
        )
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
          accountAddr: msgAddress,
          networkId: network.id
        },
        dappPromise
      } as SignUserRequest
    } else if (kind === 'typedMessage') {
      if (!this.accounts.selectedAccount) throw ethErrors.rpc.internal()

      const msg = request.params
      if (!msg) {
        throw ethErrors.rpc.invalidRequest('No msg request to sign')
      }
      const msgAddress = getAddress(msg?.[0])
      // TODO: if address is in this.accounts in theory the user should be able to sign
      // e.g. if an acc from the wallet is used as a signer of another wallet
      if (msgAddress !== this.accounts.selectedAccount) {
        dappPromise.reject(
          ethErrors.provider.userRejectedRequest(
            // if updating, check https://github.com/AmbireTech/ambire-wallet/pull/1627
            'the dApp is trying to sign using an address different from the currently selected account. Try re-connecting.'
          )
        )
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
          accountAddr: msgAddress,
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

    if (userRequest.action.kind !== 'calls') {
      const otherUserRequestFromSameDapp = this.userRequests.find(
        (r) => r.dappPromise?.session?.origin === dappPromise?.session?.origin
      )

      if (!otherUserRequestFromSameDapp && !!dappPromise?.session?.origin) {
        withPriority = true
      }
    }

    if (userRequest) {
      await this.addUserRequest(userRequest, withPriority)
      this.emitUpdate()
    }
  }

  async buildTransferUserRequest(
    amount: string,
    recipientAddress: string,
    selectedToken: TokenResult,
    executionType: 'queue' | 'open' = 'open'
  ) {
    await this.#initialLoadPromise
    if (!this.accounts.selectedAccount) return

    const account = this.accounts.accounts.find((a) => a.addr === this.accounts.selectedAccount)!

    const userRequest = buildTransferUserRequest({
      selectedAccount: this.accounts.selectedAccount,
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

    await this.addUserRequest(userRequest, !account.creation, executionType)
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
            r.action.kind === 'calls' &&
            r.meta.accountAddr === userRequest.meta.accountAddr &&
            r.meta.networkId === userRequest.meta.networkId
          )
      )
    }

    userRequest.dappPromise?.reject(ethErrors.provider.userRejectedRequest<any>(err))
    this.removeUserRequest(requestId)
    this.emitUpdate()
  }

  async addUserRequest(
    req: UserRequest,
    withPriority?: boolean,
    executionType: 'queue' | 'open' = 'open'
  ) {
    if (withPriority) {
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
      await this.#ensureAccountInfo(meta.accountAddr, meta.networkId)
      if (this.signAccOpInitError) {
        return req.dappPromise?.reject(
          ethErrors.provider.custom({
            code: 1001,
            message: this.signAccOpInitError
          })
        )
      }

      const account = this.accounts.accounts.find((x) => x.addr === meta.accountAddr)!
      const accountState = this.accounts.accountStates[meta.accountAddr][meta.networkId]

      if (account.creation) {
        const network = this.networks.networks.find((n) => n.id === meta.networkId)!

        // find me the accountOp for the network if any, it's always 1 for SA
        const currentAccountOpAction = this.actions.actionsQueue.find(
          (a) =>
            a.type === 'accountOp' &&
            a.accountOp.accountAddr === account.addr &&
            a.accountOp.networkId === network.id
        ) as AccountOpAction | undefined

        const activityFilters = {
          account: account.addr,
          network: network.id
        }
        if (!this.activity.isInitialized) {
          this.activity.init(activityFilters)
        } else {
          this.activity.setFilters(activityFilters)
        }

        const entryPointAuthorizationMessageFromHistory = this.activity.signedMessages?.items.find(
          (message) =>
            message.fromActionId === ENTRY_POINT_AUTHORIZATION_REQUEST_ID &&
            message.networkId === network.id
        )
        const hasAuthorized =
          !!currentAccountOpAction?.accountOp?.meta?.entryPointAuthorization ||
          !!entryPointAuthorizationMessageFromHistory

        if (shouldAskForEntryPointAuthorization(network, account, accountState, hasAuthorized)) {
          await this.addEntryPointAuthorization(req, network, accountState, executionType)
          this.emitUpdate()
          return
        }

        const accountOpAction = makeSmartAccountOpAction({
          account,
          networkId: meta.networkId,
          nonce: accountState.nonce,
          userRequests: this.userRequests,
          actionsQueue: this.actions.actionsQueue,
          entryPointAuthorizationSignature:
            entryPointAuthorizationMessageFromHistory?.signature ?? undefined
        })
        this.actions.addOrUpdateAction(accountOpAction, withPriority, executionType)
        if (this.signAccountOp) {
          if (this.signAccountOp.fromActionId === accountOpAction.id) {
            this.signAccountOp.update({ accountOp: accountOpAction.accountOp })
            this.estimateSignAccountOp()
          }
        } else {
          // Even without an initialized SignAccountOpController or Screen, we should still update the portfolio and run the simulation.
          // It's necessary to continue operating with the token `amountPostSimulation` amount.
          this.updateSelectedAccountPortfolio(true, network)
        }
      } else {
        const accountOpAction = makeBasicAccountOpAction({
          account,
          networkId: meta.networkId,
          nonce: accountState.nonce,
          userRequest: req
        })
        this.actions.addOrUpdateAction(accountOpAction, withPriority, executionType)
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
        withPriority,
        executionType
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
    if (action.kind === 'calls') {
      const network = this.networks.networks.find((net) => net.id === meta.networkId)!
      const account = this.accounts.accounts.find((x) => x.addr === meta.accountAddr)
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
          this.updateSelectedAccountPortfolio(true, network)
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
          if (this.signAccountOp && this.signAccountOp.fromActionId === accountOpAction.id) {
            this.destroySignAccOp()
          }
          this.actions.removeAction(`${meta.accountAddr}-${meta.networkId}`)
          this.updateSelectedAccountPortfolio(true, network)
        }
      } else {
        if (this.signAccountOp && this.signAccountOp.fromActionId === req.id) {
          this.destroySignAccOp()
        }
        this.actions.removeAction(id)
        this.updateSelectedAccountPortfolio(true, network)
      }
    } else {
      this.actions.removeAction(id)
    }
    this.emitUpdate()
  }

  async addEntryPointAuthorization(
    req: UserRequest,
    network: Network,
    accountState: AccountOnchainState,
    executionType: 'queue' | 'open' = 'open'
  ) {
    if (
      this.actions.visibleActionsQueue.find(
        (a) =>
          a.id === ENTRY_POINT_AUTHORIZATION_REQUEST_ID &&
          (a as SignMessageAction).userRequest.meta.networkId === req.meta.networkId
      )
    ) {
      this.actions.setCurrentActionById(ENTRY_POINT_AUTHORIZATION_REQUEST_ID)
      return
    }

    const typedMessageAction = await getEntryPointAuthorization(
      req.meta.accountAddr,
      network.chainId,
      BigInt(accountState.nonce)
    )
    await this.addUserRequest(
      {
        id: ENTRY_POINT_AUTHORIZATION_REQUEST_ID,
        action: typedMessageAction,
        meta: {
          isSignAction: true,
          accountAddr: req.meta.accountAddr,
          networkId: req.meta.networkId
        },
        session: req.session,
        dappPromise: req?.dappPromise
          ? { reject: req?.dappPromise?.reject, resolve: () => {} }
          : undefined
      } as SignUserRequest,
      true,
      executionType
    )
  }

  async addNetwork(network: AddNetworkRequestParams) {
    await this.networks.addNetwork(network)
    await this.updateSelectedAccountPortfolio(true)
  }

  async removeNetwork(id: NetworkId) {
    await this.networks.removeNetwork(id)
    await this.updateSelectedAccountPortfolio(true)
  }

  async resolveAccountOpAction(data: any, actionId: AccountOpAction['id']) {
    const accountOpAction = this.actions.actionsQueue.find((a) => a.id === actionId)
    if (!accountOpAction) return

    const { accountOp } = accountOpAction as AccountOpAction
    const chainId = this.networks.networks.find(
      (network) => network.id === accountOp.networkId
    )?.chainId

    if (!chainId) return

    const meta: SignUserRequest['meta'] = {
      isSignAction: true,
      accountAddr: accountOp.accountAddr,
      chainId,
      networkId: '',
      txnId: null,
      userOpHash: null
    }
    if (data.submittedAccountOp) {
      // can be undefined, check submittedAccountOp.ts
      meta.txnId = data.submittedAccountOp.txnId

      meta.identifiedBy = data.submittedAccountOp.identifiedBy
    }
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
      const uReq = this.userRequests.find((r) => r.id === call.fromUserRequestId)
      if (uReq) {
        uReq.dappPromise?.reject(ethErrors.provider.userRejectedRequest<any>(err))
        // eslint-disable-next-line no-await-in-loop
        this.removeUserRequest(uReq.id)
      }
    }

    this.emitUpdate()
  }

  async #updateGasPrice() {
    await this.#initialLoadPromise

    // if there's no signAccountOp initialized, we don't want to fetch gas
    const accOp = this.signAccountOp?.accountOp ?? null
    if (!accOp) return undefined

    const network = this.networks.networks.find((net) => net.id === accOp.networkId)
    if (!network) return undefined // shouldn't happen

    const is4337 = isErc4337Broadcast(
      network,
      this.accounts.accountStates[accOp.accountAddr][accOp.networkId]
    )
    const bundlerFetch = async () => {
      if (!is4337) return null
      return Bundler.fetchGasPrices(network).catch((e) => {
        this.emitError({
          level: 'silent',
          message: "Failed to fetch the bundler's gas price",
          error: e
        })
      })
    }
    const [gasPriceData, bundlerGas] = await Promise.all([
      getGasPriceRecommendations(this.providers.providers[network.id], network).catch((e) => {
        this.emitError({
          level: 'major',
          message: `Unable to get gas price for ${network.id}`,
          error: new Error(`Failed to fetch gas price: ${e?.message}`)
        })
        return null
      }),
      bundlerFetch()
    ])

    if (gasPriceData && gasPriceData.gasPrice) this.gasPrices[network.id] = gasPriceData.gasPrice
    if (bundlerGas) this.bundlerGasPrices[network.id] = bundlerGas

    return {
      blockGasLimit: gasPriceData?.blockGasLimit
    }
  }

  async updateSignAccountOpGasPrice() {
    if (!this.signAccountOp) return

    const accOp = this.signAccountOp.accountOp
    const gasData = await this.#updateGasPrice()

    // there's a chance signAccountOp gets destroyed between the time
    // the first "if (!this.signAccountOp) return" is performed and
    // the time we get here. To prevent issues, we check one more time
    if (!this.signAccountOp) return

    this.signAccountOp.update({
      gasPrices: this.gasPrices[accOp.networkId],
      bundlerGasPrices: this.bundlerGasPrices[accOp.networkId],
      blockGasLimit: gasData && gasData.blockGasLimit ? gasData.blockGasLimit : undefined
    })
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
      const account = this.accounts.accounts.find((x) => x.addr === localAccountOp.accountAddr)

      // Here, we list EOA accounts for which you can also obtain an estimation of the AccountOp payment.
      // In the case of operating with a smart account (an account with creation code), all other EOAs can pay the fee.
      //
      // If the current account is an EOA, only this account can pay the fee,
      // and there's no need for checking other EOA accounts native balances.
      // This is already handled and estimated as a fee option in the estimate library, which is why we pass an empty array here.
      //
      // we're excluding the view only accounts from the natives to check
      // in all cases EXCEPT the case where we're making an estimation for
      // the view only account itself. In all other, view only accounts options
      // should not be present as the user cannot pay the fee with them (no key)
      const nativeToCheck = account?.creation
        ? this.accounts.accounts
            .filter(
              (acc) =>
                !isSmartAccount(acc) &&
                (acc.addr === localAccountOp.accountAddr ||
                  !getIsViewOnly(this.keystore.keys, acc.associatedKeys))
            )
            .map((acc) => acc.addr)
        : []

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
      // The gasTank tokens participate on each network as they belong everywhere
      // NOTE: at some point we should check all the "?" signs below and if
      // an error pops out, we should notify the user about it
      const networkFeeTokens =
        this.portfolio.latest?.[localAccountOp.accountAddr]?.[localAccountOp.networkId]?.result
          ?.tokens ?? []
      const gasTankFeeTokens =
        this.portfolio.latest?.[localAccountOp.accountAddr]?.gasTank?.result?.tokens ?? []

      const feeTokens =
        [...networkFeeTokens, ...gasTankFeeTokens].filter((t) => t.flags.isFeeToken) || []

      // Reverse lookup addresses and save them in memory so they
      // can be read from the UI
      const humanization = await humanizeAccountOp(
        this.#storage,
        localAccountOp,
        this.fetch,
        this.emitError
      )
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

      this.portfolio.addTokensToBeLearned(additionalHints, network.id)

      const accountOpsToBeSimulatedByNetwork = getAccountOpsForSimulation(
        account!,
        this.actions.visibleActionsQueue,
        network,
        this.signAccountOp?.accountOp
      )

      const [, estimation] = await Promise.all([
        // NOTE: we are not emitting an update here because the portfolio controller will do that
        // NOTE: the portfolio controller has it's own logic of constructing/caching providers, this is intentional, as
        // it may have different needs
        this.portfolio.updateSelectedAccount(
          localAccountOp.accountAddr,
          network,
          accountOpsToBeSimulatedByNetwork,
          { forceUpdate: true }
        ),
        estimate(
          this.providers.providers[localAccountOp.networkId],
          network,
          account,
          localAccountOp,
          this.accounts.accountStates,
          nativeToCheck,
          // @TODO - first time calling this, portfolio is still not loaded.
          feeTokens,
          {
            is4337Broadcast: isErc4337Broadcast(
              network,
              this.accounts.accountStates[localAccountOp.accountAddr][localAccountOp.networkId]
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

      if (estimation) {
        const currentNonceAhead =
          BigInt(estimation.currentAccountNonce) > (localAccountOp.nonce ?? 0n)

        // if the nonce from the estimation is bigger than the one in localAccountOp,
        // override the accountState and accountOp with the newly detected nonce
        if (currentNonceAhead) {
          localAccountOp.nonce = BigInt(estimation.currentAccountNonce)
          this.signAccountOp.accountOp.nonce = BigInt(estimation.currentAccountNonce)

          if (this.accounts.accountStates?.[localAccountOp.accountAddr]?.[localAccountOp.networkId])
            this.accounts.accountStates[localAccountOp.accountAddr][
              localAccountOp.networkId
            ].nonce = localAccountOp.nonce
        }

        const hasNonceDiscrepancy = estimation.error?.cause === 'NONCE_FAILURE'
        const lastTxn = this.activity.getLastTxn(localAccountOp.networkId)
        const SAHasOldNonceOnARelayerNetwork =
          isSmartAccount(account) &&
          !network.erc4337.enabled &&
          lastTxn &&
          localAccountOp.nonce === lastTxn.nonce

        if (hasNonceDiscrepancy || SAHasOldNonceOnARelayerNetwork) {
          this.accounts
            .updateAccountState(localAccountOp.accountAddr, 'pending', [localAccountOp.networkId])
            .then(() => this.estimateSignAccountOp())
            .catch((error) =>
              this.emitError({
                level: 'major',
                message:
                  'Failed to refetch the account state. Please try again to initialize your transaction',
                error
              })
            )
          return
        }
      }

      if (
        estimation &&
        estimation.nonFatalErrors &&
        estimation.nonFatalErrors.find((err) => err.cause === '4337_INVALID_NONCE') &&
        this.accounts.accountStates?.[localAccountOp.accountAddr]?.[localAccountOp.networkId]
      ) {
        this.accounts
          .updateAccountState(localAccountOp.accountAddr, 'pending', [localAccountOp.networkId])
          .then(() => this.estimateSignAccountOp())
          .catch((error) =>
            this.emitError({
              level: 'major',
              message:
                'Failed to refetch the account state. Please try again to initialize your transaction',
              error
            })
          )

        // returning here means estimation will not be set => better UX as
        // the user will not see the warning but instead
        // just wait for the new estimation
        return
      }

      // check if an RBF should be applied for the incoming transaction
      // for SA conditions are: take the last broadcast but not confirmed accOp
      // and check if the nonce is the same as the current nonce (non 4337 txns)
      // for EOA: check the last broadcast but not confirmed txn across SA
      // as the EOA could've broadcast a txn there + it's own history and
      // compare the highest found nonce
      const rbfAccountOps: { [key: string]: SubmittedAccountOp | null } = {}
      nativeToCheck.push(localAccountOp.accountAddr)
      nativeToCheck.forEach((accId) => {
        const notConfirmedOp = this.activity.getNotConfirmedOpIfAny(accId, localAccountOp.networkId)
        const currentNonce = this.accounts.accountStates?.[accId]?.[localAccountOp.networkId].nonce
        rbfAccountOps[accId] =
          notConfirmedOp &&
          !notConfirmedOp.gasFeePayment?.isERC4337 &&
          currentNonce === notConfirmedOp.nonce
            ? notConfirmedOp
            : null
      })

      // if there's an estimation error, override the pending results
      if (estimation && estimation.error) {
        this.portfolio.overridePendingResults(localAccountOp)
      }
      // update the signAccountOp controller once estimation finishes;
      // this eliminates the infinite loading bug if the estimation comes slower
      if (this.signAccountOp && estimation) {
        this.signAccountOp.update({ estimation, rbfAccountOps })
      }
    } catch (error: any) {
      this.signAccountOp?.calculateWarnings()
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
  async #broadcastSignedAccountOp() {
    const accountOp = this.signAccountOp?.accountOp
    const estimation = this.signAccountOp?.estimation
    const actionId = this.signAccountOp?.fromActionId
    const contactSupportPrompt = 'Please try again or contact support if the problem persists.'

    if (
      !accountOp ||
      !estimation ||
      !actionId ||
      !accountOp.signingKeyAddr ||
      !accountOp.signingKeyType ||
      !accountOp.signature
    ) {
      const message = `Missing mandatory transaction details. ${contactSupportPrompt}`
      return this.#throwBroadcastAccountOp({ message })
    }

    const provider = this.providers.providers[accountOp.networkId]
    const account = this.accounts.accounts.find((acc) => acc.addr === accountOp.accountAddr)
    const network = this.networks.networks.find((n) => n.id === accountOp.networkId)

    if (!provider) {
      const networkName = network?.name || `network with id ${accountOp.networkId}`
      const message = `Provider for ${networkName} not found. ${contactSupportPrompt}`
      return this.#throwBroadcastAccountOp({ message })
    }

    if (!account) {
      const addr = shortenAddress(accountOp.accountAddr, 13)
      const message = `Account with address ${addr} not found. ${contactSupportPrompt}`
      return this.#throwBroadcastAccountOp({ message })
    }

    if (!network) {
      const message = `Network with id ${accountOp.networkId} not found. ${contactSupportPrompt}`
      return this.#throwBroadcastAccountOp({ message })
    }

    let transactionRes: {
      txnId?: string
      nonce: number
      identifiedBy: AccountOpIdentifiedBy
    } | null = null

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
          const missingKeyAddr = shortenAddress(accountOp.gasFeePayment!.paidBy, 13)
          const accAddr = shortenAddress(accountOp.accountAddr, 13)
          const message = `Key with address ${missingKeyAddr} for account with address ${accAddr} not found. ${contactSupportPrompt}`
          return await this.#throwBroadcastAccountOp({ message })
        }
        this.feePayerKey = feePayerKey
        this.emitUpdate()

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
        if (gasFeePayment.maxPriorityFeePerGas !== undefined) {
          rawTxn.maxFeePerGas = gasFeePayment.gasPrice
          rawTxn.maxPriorityFeePerGas = gasFeePayment.maxPriorityFeePerGas
          rawTxn.type = 2
        } else {
          rawTxn.gasPrice = gasFeePayment.gasPrice
          rawTxn.type = 0
        }

        const signedTxn = await signer.signRawTransaction(rawTxn)
        try {
          const broadcastRes = await provider.broadcastTransaction(signedTxn)
          transactionRes = {
            txnId: broadcastRes.hash,
            nonce: broadcastRes.nonce,
            identifiedBy: {
              type: 'Transaction',
              identifier: broadcastRes.hash
            }
          }
        } catch (e: any) {
          const reason = e?.message || 'unknown'

          throw new Error(
            `Transaction couldn't be broadcasted on the ${network.name} network. Reason: ${reason}`
          )
        }
      } catch (error: any) {
        return this.#throwBroadcastAccountOp({ error, network })
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
        const missingKeyAddr = shortenAddress(accountOp.gasFeePayment!.paidBy, 13)
        const accAddr = shortenAddress(accountOp.accountAddr, 13)
        const message = `Key with address ${missingKeyAddr} for account with address ${accAddr} not found.`
        return this.#throwBroadcastAccountOp({ message })
      }

      this.feePayerKey = feePayerKey
      this.emitUpdate()

      const accountState = this.accounts.accountStates[accountOp.accountAddr][accountOp.networkId]
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
          rawTxn.maxFeePerGas = accountOp.gasFeePayment.gasPrice
          rawTxn.maxPriorityFeePerGas = accountOp.gasFeePayment.maxPriorityFeePerGas
          rawTxn.type = 2
        } else {
          rawTxn.gasPrice = accountOp.gasFeePayment.gasPrice
          rawTxn.type = 0
        }

        const signedTxn = await signer.signRawTransaction(rawTxn)
        try {
          const broadcastRes = await provider.broadcastTransaction(signedTxn)
          transactionRes = {
            txnId: broadcastRes.hash,
            nonce: broadcastRes.nonce,
            identifiedBy: {
              type: 'Transaction',
              identifier: broadcastRes.hash
            }
          }
        } catch (e: any) {
          const reason = e?.message || 'unknown'

          throw new Error(
            `Transaction couldn't be broadcasted on the ${network.name} network. Reason: ${reason}`
          )
        }
      } catch (error: any) {
        return this.#throwBroadcastAccountOp({ error, network })
      }
    }
    // Smart account, the ERC-4337 way
    else if (accountOp.gasFeePayment && accountOp.gasFeePayment.isERC4337) {
      const userOperation = accountOp.asUserOperation
      if (!userOperation) {
        const accAddr = shortenAddress(accountOp.accountAddr, 13)
        const message = `Trying to broadcast an ERC-4337 request but userOperation is not set for the account with address ${accAddr}`
        return this.#throwBroadcastAccountOp({ message })
      }

      // broadcast through bundler's service
      let userOperationHash
      try {
        userOperationHash = await bundler.broadcast(userOperation, network!)
      } catch (e: any) {
        return this.#throwBroadcastAccountOp({
          message: Bundler.decodeBundlerError(
            e,
            'Bundler broadcast failed. Please try broadcasting by an EOA or contact support.'
          ),
          network
        })
      }
      if (!userOperationHash) {
        return this.#throwBroadcastAccountOp({
          message: 'Bundler broadcast failed. Please try broadcasting by an EOA or contact support.'
        })
      }

      transactionRes = {
        nonce: Number(userOperation.nonce),
        identifiedBy: {
          type: 'UserOperation',
          identifier: userOperationHash
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
        const response = await this.callRelayer(
          `/identity/${accountOp.accountAddr}/${accountOp.networkId}/submit`,
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
        return this.#throwBroadcastAccountOp({ error, network })
      }
    }

    if (!transactionRes)
      return this.#throwBroadcastAccountOp({
        message: 'No transaction response received after being broadcasted.'
      })

    const submittedAccountOp: SubmittedAccountOp = {
      ...accountOp,
      status: AccountOpStatus.BroadcastedButNotConfirmed,
      txnId: transactionRes.txnId,
      nonce: BigInt(transactionRes.nonce),
      identifiedBy: transactionRes.identifiedBy,
      timestamp: new Date().getTime(),
      isSingletonDeploy: !!accountOp.calls.find((call) => getAddress(call.to) === SINGLETON)
    }
    await this.activity.addAccountOp(submittedAccountOp)
    await this.resolveAccountOpAction(
      {
        networkId: network.id,
        isUserOp: !!accountOp?.asUserOperation,
        submittedAccountOp
      },
      actionId
    )
    await this.#notificationManager.create({
      title: 'Done!',
      message: 'The transaction was successfully signed and broadcasted to the network.'
    })
    return Promise.resolve(submittedAccountOp)
  }

  // ! IMPORTANT !
  // Banners that depend on async data from sub-controllers should be implemented
  // in the sub-controllers themselves. This is because updates in the sub-controllers
  // will not trigger emitUpdate in the MainController, therefore the banners will
  // remain the same until a subsequent update in the MainController.
  get banners(): Banner[] {
    if (!this.accounts.selectedAccount || !this.networks.isInitialized) return []

    const accountOpBanners = getAccountOpBanners({
      accountOpActionsByNetwork: getAccountOpActionsByNetwork(
        this.accounts.selectedAccount,
        this.actions.actionsQueue
      ),
      selectedAccount: this.accounts.selectedAccount,
      accounts: this.accounts.accounts,
      networks: this.networks.networks
    })

    return [...accountOpBanners]
  }

  #throwBroadcastAccountOp({
    message: _msg,
    error: _err,
    network
  }: {
    message?: string
    error?: Error
    network?: Network
  }) {
    let message = _msg || _err?.message || 'Unable to broadcast the transaction.'

    if (message) {
      if (message.includes('insufficient funds')) {
        if (network)
          message = `You don't have enough ${network.nativeAssetSymbol} to cover the transaction fee`
        else message = "You don't have enough native to cover the transaction fee"
      } else if (message.includes('pimlico_getUserOperationGasPrice')) {
        // sometimes the bundler returns an error of low maxFeePerGas
        // in that case, recalculate prices and prompt the user to try again
        message = 'Fee too low. Please select a higher transaction speed and try again'
        this.updateSignAccountOpGasPrice()
      } else if (
        message.includes('Transaction underpriced. Please select a higher fee and try again')
      ) {
        // this error comes from the relayer when using the paymaster service.
        // as it could be from lower PVG, we should reestimate as well
        message = 'Fee too low. Please select a higher transaction speed and try again'
        this.updateSignAccountOpGasPrice()
        this.estimateSignAccountOp()
      } else {
        // Trip the error message, errors coming from the RPC can be huuuuuge
        message = message.length > 300 ? `${message.substring(0, 300)}...` : message
      }
    }

    const error = _err || new Error(message)
    const replacementFeeLow = error?.message.includes('replacement fee too low')
    // To enable another try for signing in case of broadcast fail
    // broadcast is called in the FE only after successful signing
    this.signAccountOp?.updateStatus(SigningStatus.ReadyToSign, replacementFeeLow)
    if (replacementFeeLow) this.estimateSignAccountOp()

    this.feePayerKey = null

    return Promise.reject(new EmittableError({ level: 'major', message, error }))
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
