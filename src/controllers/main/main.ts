import { ethErrors } from 'eth-rpc-errors'
/* eslint-disable @typescript-eslint/brace-style */
import { getAddress, getBigInt, Interface, isAddress, TransactionResponse } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import EmittableError from '../../classes/EmittableError'
import { AMBIRE_ACCOUNT_FACTORY, SINGLETON } from '../../consts/deploy'
import { Account, AccountId, AccountOnchainState } from '../../interfaces/account'
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
import { Storage } from '../../interfaces/storage'
import { Calls, DappUserRequest, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import { isSmartAccount } from '../../libs/account/account'
import { AccountOp, AccountOpStatus, getSignableCalls } from '../../libs/accountOp/accountOp'
import { Call as AccountOpCall } from '../../libs/accountOp/types'
import {
  dappRequestMethodToActionKind,
  getAccountOpActionsByNetwork,
  getAccountOpFromAction
} from '../../libs/actions/actions'
import { getAccountOpBanners } from '../../libs/banners/banners'
import { estimate } from '../../libs/estimate/estimate'
import { EstimateResult } from '../../libs/estimate/interfaces'
import { GasRecommendation, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { humanizeAccountOp } from '../../libs/humanizer'
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
import { ActivityController, SubmittedAccountOp } from '../activity/activity'
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
  broadcastSignedAccountOp: 'INITIAL',
  removeAccount: 'INITIAL'
} as const

export class MainController extends EventEmitter {
  #storage: Storage

  #fetch: Fetch

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  #callRelayer: Function

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

  signAccOpInitError: string | null = null

  activity!: ActivityController

  settings: SettingsController

  addressBook: AddressBookController

  domains: DomainsController

  accounts: AccountsController

  userRequests: UserRequest[] = []

  // network => GasRecommendation[]
  gasPrices: { [key: string]: GasRecommendation[] } = {}

  accountOpsToBeConfirmed: { [key: string]: { [key: string]: AccountOp } } = {}

  // TODO: Temporary solution to expose the fee payer key during Account Op broadcast.
  feePayerKey: Key | null = null

  lastUpdate: Date = new Date()

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  #windowManager: WindowManager

  /**
   * Callback that gets triggered when the signing process of a message or an
   * account op (including the broadcast step) gets finalized.
   */
  onSignSuccess: (type: 'message' | 'typed-data' | 'account-op') => void

  constructor({
    storage,
    fetch,
    relayerUrl,
    velcroUrl,
    keystoreSigners,
    externalSignerControllers,
    windowManager,
    onSignSuccess
  }: {
    storage: Storage
    fetch: Fetch
    relayerUrl: string
    velcroUrl: string
    keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>
    externalSignerControllers: ExternalSignerControllers
    windowManager: WindowManager
    onSignSuccess?: (type: 'message' | 'typed-data' | 'account-op') => void
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
      this.#fetch,
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
        await this.updateSelectedAccountPortfolio()
        // forceEmitUpdate to update the getters in the FE state of the ctrl
        await this.forceEmitUpdate()
        await this.actions.forceEmitUpdate()
        await this.addressBook.forceEmitUpdate()
        this.dapps.broadcastDappSessionEvent('accountsChanged', [toAccountAddr])
      },
      this.providers.updateProviderIsWorking.bind(this.providers)
    )
    this.settings = new SettingsController(this.#storage)
    this.portfolio = new PortfolioController(
      this.#storage,
      this.#fetch,
      this.providers,
      this.networks,
      this.accounts,
      relayerUrl,
      velcroUrl
    )
    this.#initialLoadPromise = this.#load()
    this.emailVault = new EmailVaultController(
      this.#storage,
      this.#fetch,
      relayerUrl,
      this.keystore
    )
    this.accountAdder = new AccountAdderController({
      accounts: this.accounts,
      keystore: this.keystore,
      relayerUrl,
      fetch: this.#fetch
    })
    this.addressBook = new AddressBookController(this.#storage, this.accounts)
    this.signMessage = new SignMessageController(
      this.keystore,
      this.providers,
      this.networks,
      this.accounts,
      this.#externalSignerControllers,
      this.#storage,
      this.#fetch
    )
    this.dapps = new DappsController(this.#storage)
    this.actions = new ActionsController({
      accounts: this.accounts,
      windowManager,
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
    this.activity = new ActivityController(
      this.#storage,
      this.#fetch,
      this.accounts,
      this.providers,
      this.networks,
      async (network: Network) => {
        await this.setContractsDeployedToTrueIfDeployed(network)
      }
    )
    this.domains = new DomainsController(this.providers.providers, this.#fetch)
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch: this.#fetch })
    this.onSignSuccess = onSignSuccess || (() => {})
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
    this.updateSelectedAccountPortfolio()

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
          await this.settings.addKeyPreferences(this.accountAdder.readyToAddKeyPreferences)
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
      this.#fetch,
      this.#callRelayer
    )

    this.emitUpdate()

    this.updateSignAccountOpGasPrice()
    this.estimateSignAccountOp()
  }

  async handleSignAccountOp() {
    if (!this.signAccountOp) {
      const message =
        'The signing process was not initialized as expected. Please try again later or contact Ambire support if the issue persists.'
      const error = new Error('SignAccountOp is not initialized')
      return this.emitError({ level: 'major', message, error })
    }

    await this.signAccountOp.sign()

    // Error handling on the prev step will notify the user, it's fine to return here
    if (this.signAccountOp.status?.type !== SigningStatus.Done) return

    await this.withStatus('broadcastSignedAccountOp', async () => this.#broadcastSignedAccountOp())
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
    const addresses = await debugTraceCall(
      account,
      accountOp,
      provider,
      state,
      estimation.gasUsed,
      gasPrice,
      !network.rpcNoStateOverride
    )
    const learnedNewTokens = await this.portfolio.learnTokens(addresses, network.id)

    // update the portfolio only if new tokens were found through tracing
    if (learnedNewTokens) {
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
      accountAddr && networkId && !this.accounts.accountStates[accountAddr]?.[networkId]
    if (shouldForceUpdateAndWaitForAccountState)
      await this.accounts.updateAccountState(accountAddr, 'latest', [networkId])

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

    await this.resolveUserRequest({ hash: signedMessage.signature }, signedMessage.fromActionId)

    this.onSignSuccess(signedMessage.content.kind === 'typedMessage' ? 'typed-data' : 'message')

    // TODO: In the rare case when this might error, the user won't be notified,
    // since `this.resolveUserRequest` closes the action window.
    await this.activity.addSignedMessage(signedMessage, signedMessage.accountAddr)
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
          this.gasPrices[network] = await getGasPriceRecommendations(
            this.providers.providers[network],
            this.networks.networks.find((net) => net.id === network)!
          )
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
      this.settings.removeKeyPreferences([{ addr: key.addr, type: key.type }]).catch((e) => {
        throw new EmittableError({
          level: 'major',
          message: 'Failed to remove account key preferences',
          error: e
        })
      })
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

  #batchCallsFromUserRequests(accountAddr: AccountId, networkId: NetworkId): AccountOpCall[] {
    // Note: we use reduce instead of filter/map so that the compiler can deduce that we're checking .kind
    return (this.userRequests.filter((r) => r.action.kind === 'calls') as SignUserRequest[]).reduce(
      (uCalls: AccountOpCall[], req) => {
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

    await Promise.all([
      this.accounts.updateAccountState(this.accounts.selectedAccount, 'pending'),
      this.updateSelectedAccountPortfolio(true)
    ])
  }

  // eslint-disable-next-line default-param-last
  async updateSelectedAccountPortfolio(forceUpdate: boolean = false, network?: Network) {
    await this.#initialLoadPromise
    if (!this.accounts.selectedAccount) return

    const account = this.accounts.accounts.find((a) => a.addr === this.accounts.selectedAccount)

    const accountOpsToBeSimulatedByNetwork = getAccountOpsForSimulation(
      account!,
      this.actions.visibleActionsQueue,
      network,
      this.signAccountOp ? this.signAccountOp.accountOp : null
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
      resolve: (data: any) => void
      reject: (data: any) => void
    }
  ) {
    await this.#initialLoadPromise
    let userRequest = null
    const kind = dappRequestMethodToActionKind(request.method)
    const dapp = this.dapps.getDapp(request.origin)

    if (kind === 'calls') {
      if (!this.accounts.selectedAccount) throw ethErrors.rpc.internal()

      const transaction = request.params[0]
      const accountAddr = getAddress(transaction.from)
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
          calls: [
            {
              to: transaction.to,
              value: transaction.value ? getBigInt(transaction.value) : 0n,
              data: transaction.data || '0x'
            }
          ]
        },
        meta: { isSignAction: true, accountAddr, networkId: network.id },
        dappPromise
      } as SignUserRequest
    } else if (kind === 'message') {
      if (!this.accounts.selectedAccount) throw ethErrors.rpc.internal()

      const msg = request.params
      if (!msg) {
        throw ethErrors.rpc.invalidRequest('No msg request to sign')
      }
      const msdAddress = getAddress(msg?.[1])
      // TODO: if address is in this.accounts in theory the user should be able to sign
      // e.g. if an acc from the wallet is used as a signer of another wallet
      if (getAddress(msdAddress) !== this.accounts.selectedAccount) {
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
          accountAddr: msdAddress,
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
      const msdAddress = getAddress(msg?.[0])
      // TODO: if address is in this.accounts in theory the user should be able to sign
      // e.g. if an acc from the wallet is used as a signer of another wallet
      if (getAddress(msdAddress) !== this.accounts.selectedAccount) {
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
    await this.#initialLoadPromise
    if (!this.accounts.selectedAccount) return

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

  async addUserRequest(req: UserRequest, withPriority?: boolean) {
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

        const hasAuthorized = !!currentAccountOpAction?.accountOp?.meta?.entryPointAuthorization
        if (shouldAskForEntryPointAuthorization(network, account, accountState, hasAuthorized)) {
          await this.addEntryPointAuthorization(req, network, accountState)
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
          this.actions.removeAction(`${meta.accountAddr}-${meta.networkId}`)
          this.updateSelectedAccountPortfolio(true, network)
        }
      } else {
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
    accountState: AccountOnchainState
  ) {
    if (
      this.actions.visibleActionsQueue.find(
        (a) =>
          a.id === ENTRY_POINT_AUTHORIZATION_REQUEST_ID &&
          (a as SignMessageAction).userRequest.meta.networkId === req.meta.networkId
      )
    ) {
      return
    }

    const typedMessageAction = await getEntryPointAuthorization(
      req.meta.accountAddr,
      network.chainId,
      BigInt(accountState.nonce)
    )
    await this.addUserRequest({
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
    } as SignUserRequest)
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

    // destroy sign account op if no actions left for account
    const accountOpsLeftForAcc = (
      this.actions.actionsQueue.filter((a) => a.type === 'accountOp') as AccountOpAction[]
    ).filter((action) => action.accountOp.accountAddr === accountOp.accountAddr)
    if (!accountOpsLeftForAcc.length) this.destroySignAccOp()

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

      // Reverse lookup addresses and save them in memory so they
      // can be read from the UI
      const humanization = await humanizeAccountOp(
        this.#storage,
        localAccountOp,
        this.#fetch,
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

      await this.portfolio.learnTokens(additionalHints, network.id)

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

      // if the nonce from the estimation is bigger than the one in localAccountOp,
      // override the accountState and accountOp with the newly detected nonce
      // and start a new estimation
      if (estimation && BigInt(estimation.currentAccountNonce) > (localAccountOp.nonce ?? 0n)) {
        localAccountOp.nonce = BigInt(estimation.currentAccountNonce)
        this.signAccountOp.accountOp.nonce = BigInt(estimation.currentAccountNonce)

        if (this.accounts.accountStates?.[localAccountOp.accountAddr]?.[localAccountOp.networkId])
          this.accounts.accountStates[localAccountOp.accountAddr][localAccountOp.networkId].nonce =
            localAccountOp.nonce

        this.estimateSignAccountOp()

        // returning here means estimation will not be set => better UX as
        // the user will not see the error "nonce discrepancy" but instead
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

      // update the signAccountOp controller once estimation finishes;
      // this eliminates the infinite loading bug if the estimation comes slower
      if (this.signAccountOp && estimation) {
        this.signAccountOp.update({ estimation, rbfAccountOps })
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
  async #broadcastSignedAccountOp() {
    const accountOp = this.signAccountOp?.accountOp
    const estimation = this.signAccountOp?.estimation
    const actionId = this.signAccountOp?.fromActionId

    if (
      !accountOp ||
      !estimation ||
      !actionId ||
      !accountOp.signingKeyAddr ||
      !accountOp.signingKeyType ||
      !accountOp.signature
    ) {
      return this.#throwBroadcastAccountOp({ message: 'Missing mandatory transaction details.' })
    }

    const provider = this.providers.providers[accountOp.networkId]
    const account = this.accounts.accounts.find((acc) => acc.addr === accountOp.accountAddr)
    const network = this.networks.networks.find((n) => n.id === accountOp.networkId)

    if (!provider) {
      return this.#throwBroadcastAccountOp({
        message: `Provider for ${network?.name || `with id ${accountOp.networkId}`} not found.`
      })
    }

    if (!account) {
      return this.#throwBroadcastAccountOp({
        message: `Account with address ${shortenAddress(accountOp.accountAddr, 13)} not found.`
      })
    }

    if (!network) {
      return this.#throwBroadcastAccountOp({
        message: `Network with id ${accountOp.networkId} not found.`
      })
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
          return await this.#throwBroadcastAccountOp({
            message: `Key with address ${shortenAddress(
              accountOp.gasFeePayment!.paidBy,
              13
            )} for account with address ${shortenAddress(accountOp.accountAddr, 13)} not found.`
          })
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
      } catch (error: any) {
        return this.#throwBroadcastAccountOp({ error })
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
        return this.#throwBroadcastAccountOp({
          message: `Key with address ${shortenAddress(
            accountOp.gasFeePayment!.paidBy,
            13
          )} for account with address ${shortenAddress(accountOp.accountAddr, 13)} not found.`
        })
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
      } catch (error: any) {
        return this.#throwBroadcastAccountOp({ error })
      }
    }
    // Smart account, the ERC-4337 way
    else if (accountOp.gasFeePayment && accountOp.gasFeePayment.isERC4337) {
      const userOperation = accountOp.asUserOperation
      if (!userOperation) {
        return this.#throwBroadcastAccountOp({
          message: `Trying to broadcast an ERC-4337 request but userOperation is not set for the account with address ${shortenAddress(
            accountOp.accountAddr,
            13
          )}`
        })
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
          )
        })
      }
      if (!userOperationHash) {
        return this.#throwBroadcastAccountOp({
          message: 'Bundler broadcast failed. Please try broadcasting by an EOA or contact support.'
        })
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
      } catch (error: any) {
        return this.#throwBroadcastAccountOp({ error })
      }
    }

    if (!transactionRes)
      return this.#throwBroadcastAccountOp({
        message: 'No transaction response received after being broadcasted.'
      })

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

    this.onSignSuccess('account-op')
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

  #throwBroadcastAccountOp({ message: _msg, error: _err }: { message?: string; error?: Error }) {
    let message = _msg || `Unable to broadcast the transaction. ${_err?.message || 'unknown'}`

    // Enhance the error incoming for this corner case
    if (message.includes('insufficient funds'))
      message = 'Insufficient funds to cover the fee for broadcasting the transaction.'

    // Trip the error message, errors coming from the RPC can be huuuuuge
    message = message.length > 300 ? `${message.substring(0, 300)}...` : message

    // If not explicitly stated, add a generic message to contact support
    if (!message.includes('contact support'))
      message += ' Please try again or contact support for help.'

    const error = _err || new Error(message)
    const replacementFeeLow = error?.message.includes('replacement fee too low')
    // To enable another try for signing in case of broadcast fail
    // broadcast is called in the FE only after successful signing
    this.signAccountOp?.updateStatusToReadyToSign(replacementFeeLow)
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
