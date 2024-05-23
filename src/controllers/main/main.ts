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
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import { SINGLETON } from '../../consts/deploy'
import { Account, AccountId, AccountOnchainState, AccountStates } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { Dapp, DappProviderRequest } from '../../interfaces/dapp'
import {
  ExternalSignerControllers,
  Key,
  KeystoreSignerType,
  TxnRequest
} from '../../interfaces/keystore'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { CustomNetwork, NetworkPreference } from '../../interfaces/settings'
import { Storage } from '../../interfaces/storage'
import {
  Call,
  DappUserRequest,
  Message,
  PlainTextMessage,
  SignUserRequest,
  TypedMessage,
  UserRequest
} from '../../interfaces/userRequest'
import { WindowManager } from '../../interfaces/window'
import { getDefaultSelectedAccount, isSmartAccount } from '../../libs/account/account'
import { AccountOp, AccountOpStatus, getSignableCalls } from '../../libs/accountOp/accountOp'
import { Call as AccountOpCall } from '../../libs/accountOp/types'
import { getAccountState } from '../../libs/accountState/accountState'
import { dappRequestMethodToActionKind } from '../../libs/actions/actions'
import { getAccountOpBanners } from '../../libs/banners/banners'
import { estimate } from '../../libs/estimate/estimate'
import { EstimateResult } from '../../libs/estimate/interfaces'
import { GasRecommendation, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { humanizeAccountOp } from '../../libs/humanizer'
import { GetOptions } from '../../libs/portfolio/interfaces'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { parse } from '../../libs/richJson/richJson'
import { isErc4337Broadcast } from '../../libs/userOperation/userOperation'
import bundler from '../../services/bundlers'
import generateSpoofSig from '../../utils/generateSpoofSig'
import wait from '../../utils/wait'
import { AccountAdderController } from '../accountAdder/accountAdder'
import { ActionsController } from '../actions/actions'
import { ActivityController, SignedMessage, SubmittedAccountOp } from '../activity/activity'
import { AddressBookController } from '../addressBook/addressBook'
import { DomainsController } from '../domains/domains'
import { EmailVaultController } from '../emailVault/emailVault'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import { SettingsController } from '../settings/settings'
/* eslint-disable no-underscore-dangle */
import { SignAccountOpController, SigningStatus } from '../signAccountOp/signAccountOp'
import { SignMessageController } from '../signMessage/signMessage'
import { TransferController } from '../transfer/transfer'

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

  accountAdder: AccountAdderController

  // Subcontrollers
  portfolio: PortfolioController

  transfer: TransferController

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

  // The reason we use a map structure and not a flat array is:
  // 1) it's easier in the UI to deal with structured data rather than having to .find/.filter/etc. all the time
  // 2) it's easier to mutate this - to add/remove accountOps, to find the right accountOp to extend, etc.
  // accountAddr => networkId => { accountOp, estimation }
  // @TODO consider getting rid of the `| null` ugliness, but then we need to auto-delete
  accountOpsToBeSigned: {
    [key: string]: {
      [key: string]: { accountOp: AccountOp; estimation: EstimateResult | null } | null
    }
  } = {}

  accountOpsToBeConfirmed: { [key: string]: { [key: string]: AccountOp } } = {}

  // accountAddr => UniversalMessage
  messagesToBeSigned: { [key: string]: Message } = {}

  lastUpdate: Date = new Date()

  broadcastStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  #relayerUrl: string

  #windowManager: WindowManager

  #getDapp: (url: string) => Dapp | undefined

  onUpdateDappSelectedAccount: (accountAddr: string) => void

  onBroadcastSuccess?: (type: 'message' | 'typed-data' | 'account-op') => void

  constructor({
    storage,
    fetch,
    relayerUrl,
    keystoreSigners,
    externalSignerControllers,
    windowManager,
    getDapp,
    onUpdateDappSelectedAccount,
    onBroadcastSuccess
  }: {
    storage: Storage
    fetch: Function
    relayerUrl: string
    keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>
    externalSignerControllers: ExternalSignerControllers
    windowManager: WindowManager
    getDapp: (url: string) => Dapp | undefined
    onUpdateDappSelectedAccount: (accountAddr: string) => void
    onBroadcastSuccess?: (type: 'message' | 'typed-data' | 'account-op') => void
  }) {
    super()
    this.#storage = storage
    this.#fetch = fetch
    this.#relayerUrl = relayerUrl
    this.#windowManager = windowManager
    this.#getDapp = getDapp

    this.invite = new InviteController({ relayerUrl, fetch, storage: this.#storage })
    this.keystore = new KeystoreController(this.#storage, keystoreSigners)
    this.#externalSignerControllers = externalSignerControllers
    this.settings = new SettingsController(this.#storage)
    this.portfolio = new PortfolioController(this.#storage, this.settings, relayerUrl)
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
      this.settings,
      this.#externalSignerControllers,
      this.#storage,
      this.#fetch
    )
    this.transfer = new TransferController(this.settings, this.addressBook)
    this.actions = new ActionsController({
      windowManager,
      onActionWindowClose: () => {
        this.userRequests = this.userRequests.filter((r) => r.action.kind !== 'benzin')
        this.emitUpdate()
      }
    })
    this.domains = new DomainsController(this.settings.providers, this.#fetch)
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch: this.#fetch })
    this.onUpdateDappSelectedAccount = onUpdateDappSelectedAccount
    this.onBroadcastSuccess = onBroadcastSuccess
  }

  async #load(): Promise<void> {
    this.isReady = false
    // #load is called in the constructor which is synchronous
    // we await (1 ms/next tick) for the constructor to extend the EventEmitter class
    // and then we call it's methods
    await wait(1)
    this.emitUpdate()
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
    this.activity = new ActivityController(this.#storage, this.accountStates, this.settings)

    if (this.selectedAccount) {
      this.activity.init({ filters: { account: this.selectedAccount } })
      this.addressBook.update({
        selectedAccount
      })
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
    this.transfer.onUpdate(async () => {
      if (this.transfer.userRequest) {
        await this.addUserRequest(this.transfer.userRequest)
        this.transfer.resetForm()
      }
    })

    this.isReady = true
    this.emitUpdate()
  }

  initSignAccOp(accountAddr: string, networkId: string): null | void {
    const accountOpToBeSigned = this.accountOpsToBeSigned?.[accountAddr]?.[networkId]?.accountOp
    const account = this.accounts?.find((acc) => acc.addr === accountAddr)
    const network = this.settings.networks.find((net) => net.id === networkId)

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

    if (!accountOpToBeSigned) {
      this.signAccOpInitError =
        'We cannot initiate the signing process because no transaction has been found for the specified account and network.'
      return null
    }

    this.signAccOpInitError = null

    this.signAccountOp = new SignAccountOpController(
      this.keystore,
      this.portfolio,
      this.settings,
      this.#externalSignerControllers,
      account,
      this.accountStates,
      network,
      accountOpToBeSigned,
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
        await this.broadcastSignedAccountOp(this.signAccountOp.accountOp)
      }
    }
    MainController.signAccountOpListener = this.signAccountOp.onUpdate(
      broadcastSignedAccountOpIfNeeded
    )

    this.emitUpdate()

    this.reestimateAndUpdatePrices(accountAddr, networkId)
  }

  destroySignAccOp() {
    this.signAccountOp = null
    MainController.signAccountOpListener() // unsubscribes for further updates

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
      ...new Set([
        ...Object.keys(this.accountOpsToBeSigned)
          .map((accountAddr) => Object.keys(this.accountOpsToBeSigned[accountAddr]))
          .flat()
        // 'ethereum'
      ])
    ]

    await Promise.all(
      gasPriceNetworks.map(async (network) => {
        try {
          this.gasPrices[network] = await getGasPriceRecommendations(
            this.settings.providers[network],
            this.settings.networks.find((net) => net.id === network)!
          )
        } catch (e: any) {
          this.emitError({
            level: 'major',
            message: `Unable to get gas price for ${
              this.settings.networks.find((n) => n.id === network)?.name
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
    updateOnlyNetworksWithIds: NetworkDescriptor['id'][] = []
  ): Promise<AccountStates> {
    // if any, update the account state only for the passed networks; else - all
    const updateOnlyPassedNetworks = updateOnlyNetworksWithIds.length
    const networksToUpdate = updateOnlyPassedNetworks
      ? this.settings.networks.filter((network) => updateOnlyNetworksWithIds.includes(network.id))
      : this.settings.networks

    const fetchedState = await Promise.all(
      networksToUpdate.map(async (network) =>
        getAccountState(this.settings.providers[network.id], network, accounts, blockTag).catch(
          () => []
        )
      )
    )

    const networkState: { [networkId: NetworkDescriptor['id']]: AccountOnchainState[] } = {}
    networksToUpdate.forEach((network: NetworkDescriptor, index) => {
      if (!fetchedState[index].length) return

      networkState[network.id] = fetchedState[index]
    })

    const states = accounts.reduce((accStates: AccountStates, acc: Account, accIndex: number) => {
      const networkStates = this.settings.networks.reduce(
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
            this.settings.updateProviderIsWorking(network.id, false)
            return netStates
          }

          this.settings.updateProviderIsWorking(network.id, true)

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

  async updateAccountStates(
    blockTag: string | number = 'latest',
    networks: NetworkDescriptor['id'][] = []
  ) {
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
    await this.withStatus(
      this.selectAccount.name,
      async () => this.#selectAccount(toAccountAddr),
      true
    )
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
    this.activity.init({ filters: { account: toAccountAddr } })
    this.addressBook.update({
      selectedAccount: toAccountAddr
    })
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.updateSelectedAccount(toAccountAddr)
    this.onUpdateDappSelectedAccount(toAccountAddr)

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

  #makeAccountOpFromUserRequests(accountAddr: AccountId, networkId: NetworkId): AccountOp | null {
    const account = this.accounts.find((x) => x.addr === accountAddr)
    if (!account)
      throw new Error(
        `makeAccountOpFromUserRequests: tried to run for non-existent account ${accountAddr}`
      )
    // Note: we use reduce instead of filter/map so that the compiler can deduce that we're checking .kind
    const calls = this.userRequests
      .filter((r) => r.action.kind === 'call')
      .reduce((uCalls: AccountOpCall[], req) => {
        // only the first one for EOAs
        if (!account.creation && uCalls.length > 0) return uCalls

        if (
          (req as SignUserRequest).meta.networkId === networkId &&
          (req as SignUserRequest).meta.accountAddr === accountAddr
        ) {
          const { to, value, data } = (req as SignUserRequest).action as Call
          uCalls.push({ to, value, data, fromUserRequestId: req.id })
        }
        return uCalls
      }, [])

    if (!calls.length) return null

    const currentAccountOp = this.accountOpsToBeSigned[accountAddr]?.[networkId]?.accountOp

    return {
      accountAddr,
      networkId,
      signingKeyAddr: currentAccountOp?.signingKeyAddr || null,
      signingKeyType: currentAccountOp?.signingKeyType || null,
      gasLimit: currentAccountOp?.gasLimit || null,
      gasFeePayment: currentAccountOp?.gasFeePayment || null,
      // We use the AccountInfo to determine
      nonce: this.accountStates[accountAddr][networkId].nonce,
      signature: account.associatedKeys[0] ? generateSpoofSig(account.associatedKeys[0]) : null,
      // @TODO from pending recoveries
      accountOpToExecuteBefore: null,
      calls
    }
  }

  async updateSelectedAccount(selectedAccount: string | null = null, forceUpdate: boolean = false) {
    if (!selectedAccount) return

    // pass the accountOps if any so we could reflect the pending state
    const accountOps = this.accountOpsToBeSigned[selectedAccount]
      ? Object.fromEntries(
          Object.entries(this.accountOpsToBeSigned[selectedAccount])
            // filter out account ops that have an estimation error
            .filter(([, accOp]) => accOp && (!accOp.estimation || !accOp.estimation.error))
            .map(([networkId, x]) => [networkId, [x!.accountOp]])
        )
      : undefined

    this.portfolio.updateSelectedAccount(
      this.accounts,
      this.settings.networks,
      selectedAccount,
      accountOps,
      { forceUpdate }
    )
  }

  async buildUserRequest(
    request: DappProviderRequest,
    dappPromise: {
      resolve: (data: any) => void
      reject: (data: any) => void
    }
  ) {
    let userRequest = null
    const kind = dappRequestMethodToActionKind(request.method)
    const dapp = this.#getDapp(request.origin)

    if (!this.selectedAccount) {
      throw ethErrors.rpc.internal()
    }

    if (kind === 'call') {
      const transaction = request.params[0]
      const accountAddr = getAddress(transaction.from)
      const network = this.settings.networks.find(
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

      const network = this.settings.networks.find(
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

      const network = this.settings.networks.find(
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

  resolveUserRequest = (data: any, requestId: number) => {
    const userRequest = this.userRequests.find((r) => r.id === requestId)
    if (!userRequest) return // TODO: emit error

    userRequest.dappPromise?.resolve(data)
    this.removeUserRequest(requestId)
    this.emitUpdate()
  }

  rejectUserRequest = (err: string, requestId: number) => {
    const userRequest = this.userRequests.find((r) => r.id === requestId)
    if (!userRequest) return // TODO: emit error

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
      if (!this.settings.networks.find((x) => x.id === meta.networkId))
        throw new Error(`addUserRequest: ${meta.networkId}: network does not exist`)
      // @TODO: if EOA, only one call per accountOp
      if (!this.accountOpsToBeSigned[meta.accountAddr])
        this.accountOpsToBeSigned[meta.accountAddr] = {}
      // @TODO
      // one solution would be to, instead of checking, have a promise that we always await here, that is responsible for fetching
      // account data; however, this won't work with EOA accountOps, which have to always pick the first userRequest for a particular acc/network,
      // and be recalculated when one gets dismissed
      // although it could work like this: 1) await the promise, 2) check if exists 3) if not, re-trigger the promise;
      // 4) manage recalc on removeUserRequest too in order to handle EOAs
      // @TODO consider re-using this whole block in removeUserRequest
      await this.#ensureAccountInfo(meta.accountAddr, meta.networkId)

      if (this.signAccOpInitError) return

      const accountOp = this.#makeAccountOpFromUserRequests(meta.accountAddr, meta.networkId)
      if (accountOp) {
        this.accountOpsToBeSigned[meta.accountAddr] ||= {}
        this.accountOpsToBeSigned[meta.accountAddr][meta.networkId] = {
          accountOp,
          estimation: null
        }
        const account = this.accounts.filter((x) => x.addr === meta.accountAddr)[0]
        this.actions.addToActionsQueue(
          {
            id: account.creation ? `${accountOp.accountAddr}-${accountOp.networkId}` : id,
            type: 'accountOp',
            accountOp,
            withBatching: !!account.creation
          },
          withPriority
        )
        if (
          this.signAccountOp &&
          this.signAccountOp.accountOp.accountAddr === accountOp.accountAddr &&
          this.signAccountOp.accountOp.networkId === accountOp.networkId
        ) {
          this.signAccountOp.update({ accountOp })
        }
        this.#estimateAccountOp(accountOp)
      }
    } else if (action.kind === 'typedMessage' || action.kind === 'message') {
      if (!this.messagesToBeSigned[meta.accountAddr]) {
        const messageRequests = this.userRequests.filter(
          (r) => r.action.kind === 'typedMessage' || r.action.kind === 'message'
        )
        if (messageRequests.length) {
          const messageRequest = messageRequests[0]
          this.messagesToBeSigned[meta.accountAddr] = {
            id: messageRequest.id,
            content: messageRequest.action as PlainTextMessage | TypedMessage,
            fromUserRequestId: messageRequest.id,
            signature: null,
            accountAddr: messageRequest.meta.accountAddr,
            networkId: messageRequest.meta.networkId
          }
        }
      }

      this.actions.addToActionsQueue(
        {
          id,
          type: 'signMessage',
          userRequest: req
        },
        withPriority
      )
    } else {
      this.actions.addToActionsQueue(
        {
          id,
          type: req.action.kind,
          userRequest: req
        },
        withPriority
      )
    }

    this.emitUpdate()
  }

  // @TODO allow this to remove multiple OR figure out a way to debounce re-estimations
  // first one sounds more reasonble
  // although the second one can't hurt and can help (or no debounce, just a one-at-a-time queue)
  removeUserRequest(id: number) {
    const req = this.userRequests.find((uReq) => uReq.id === id)
    if (!req) return

    // remove from the request queue
    this.userRequests.splice(this.userRequests.indexOf(req), 1)

    // update the pending stuff to be signed
    const { action, meta } = req
    if (action.kind === 'call') {
      // @TODO ensure acc info, re-estimate
      const accountOp = this.#makeAccountOpFromUserRequests(meta.accountAddr, meta.networkId)
      const account = this.accounts.filter((x) => x.addr === meta.accountAddr)[0]
      if (accountOp) {
        this.accountOpsToBeSigned[meta.accountAddr] ||= {}
        this.accountOpsToBeSigned[meta.accountAddr][meta.networkId] = {
          accountOp,
          estimation: null
        }
        if (
          this.signAccountOp &&
          this.signAccountOp.accountOp.accountAddr === accountOp.accountAddr &&
          this.signAccountOp.accountOp.networkId === accountOp.networkId
        ) {
          this.signAccountOp.update({ accountOp, estimation: null })
        }
        if (account.creation) {
          // if the rejectAccountOp is called we remove the calls one by one in case of multiple calls in the op
          // therefore we wait a little bit to avoid action-window initialization on remove
          setTimeout(() => {
            if (this.accountOpsToBeSigned[accountOp.accountAddr][accountOp.networkId])
              this.actions.addToActionsQueue({
                id: `${accountOp.accountAddr}-${accountOp.networkId}`,
                type: 'accountOp',
                accountOp,
                withBatching: true
              })
          }, 150)
        } else {
          this.actions.removeFromActionsQueue(id)
        }
        this.#estimateAccountOp(accountOp)
      } else {
        delete this.accountOpsToBeSigned[meta.accountAddr]?.[meta.networkId]
        if (!Object.keys(this.accountOpsToBeSigned[meta.accountAddr] || {}).length)
          delete this.accountOpsToBeSigned[meta.accountAddr]

        this.actions.removeFromActionsQueue(
          account.creation ? `${meta.accountAddr}-${meta.networkId}` : id
        )
        // remove the pending state
        this.updateSelectedAccount(this.selectedAccount, true)
      }
    } else if (action.kind === 'typedMessage' || action.kind === 'message') {
      const messageRequests = this.userRequests.filter(
        (r) => r.action.kind === 'typedMessage' || r.action.kind === 'message'
      )
      if (messageRequests.length) {
        const messageRequest = messageRequests[0]
        this.messagesToBeSigned[meta.accountAddr] = {
          id: messageRequest.id,
          content: messageRequest.action as PlainTextMessage | TypedMessage,
          fromUserRequestId: messageRequest.id,
          signature: null,
          accountAddr: messageRequest.meta.accountAddr,
          networkId: messageRequest.meta.networkId
        }
      } else {
        delete this.messagesToBeSigned[meta.accountAddr]
      }
      this.actions.removeFromActionsQueue(id)
    } else {
      this.actions.removeFromActionsQueue(id)
    }
    this.emitUpdate()
  }

  async addCustomNetwork(customNetwork: CustomNetwork) {
    await this.settings.addCustomNetwork(customNetwork)
    await this.updateSelectedAccount(this.selectedAccount, true)
  }

  async removeCustomNetwork(id: NetworkDescriptor['id']) {
    await this.settings.removeCustomNetwork(id)
    await this.updateSelectedAccount(this.selectedAccount, true)
  }

  async resolveAccountOp(data: any, accountAddr: string, networkId: string) {
    const accountOp = this.accountOpsToBeSigned?.[accountAddr]?.[networkId]?.accountOp
    if (!accountOp) return

    const meta: SignUserRequest['meta'] = {
      isSignAction: true,
      accountAddr,
      networkId,
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

  rejectAccountOp(err: string, accountAddr: string, networkId: string) {
    const accountOp = this.accountOpsToBeSigned?.[accountAddr]?.[networkId]?.accountOp
    if (!accountOp) return

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

  /**
   * Reestimate the current account op and update the gas prices in the same tick.
   * To achieve a more accurate gas amount calculation (gasUsageEstimate * gasPrice),
   * it would be preferable to update them simultaneously.
   * Otherwise, if either of the variables has not been recently updated, it may lead to an incorrect gas amount result.
   */
  async reestimateAndUpdatePrices(accountAddr: AccountId, networkId: NetworkId) {
    if (!this.signAccountOp) return

    const accountOp = this.accountOpsToBeSigned[accountAddr]?.[networkId]?.accountOp
    const reestimate = accountOp
      ? this.#estimateAccountOp(accountOp)
      : new Promise((resolve) => {
          resolve(true)
        })

    await Promise.all([this.#updateGasPrice(), reestimate])

    // there's a chance signAccountOp gets destroyed between the time
    // the first "if (!this.signAccountOp) return" is performed and
    // the time we get here. To prevent issues, we check one more time
    if (this.signAccountOp) {
      const gasPrices = this.gasPrices[networkId]
      const estimation = this.accountOpsToBeSigned[accountAddr]?.[networkId]?.estimation
      this.signAccountOp.update({ gasPrices, ...(estimation && { estimation }) })
      this.emitUpdate()
    }
  }

  // @TODO: protect this from race conditions/simultanous executions
  async #estimateAccountOp(accountOp: AccountOp) {
    try {
      // make a local copy to avoid updating the main reference
      const localAccountOp: AccountOp = { ...accountOp }

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
        throw new Error(`estimateAccountOp: ${localAccountOp.accountAddr}: account does not exist`)
      const network = this.settings.networks.find((x) => x.id === localAccountOp.networkId)
      if (!network)
        throw new Error(`estimateAccountOp: ${localAccountOp.networkId}: network does not exist`)

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
        if (this.gasPrices[accountOp.networkId] && this.gasPrices[accountOp.networkId].length) {
          const fast = this.gasPrices[accountOp.networkId][2]
          gasPrice =
            'gasPrice' in fast ? fast.gasPrice : fast.baseFeePerGas + fast.maxPriorityFeePerGas
          // increase the gas price with 10% to try to get above the min baseFee
          gasPrice += gasPrice / 10n
        }
        // 200k, try to make it work most of the times on ethereum
        let gas = 200000n
        if (
          this.accountOpsToBeSigned[localAccountOp.accountAddr] &&
          this.accountOpsToBeSigned[localAccountOp.accountAddr][localAccountOp.networkId] &&
          this.accountOpsToBeSigned[localAccountOp.accountAddr][localAccountOp.networkId]!
            .estimation
        ) {
          gas =
            this.accountOpsToBeSigned[localAccountOp.accountAddr][localAccountOp.networkId]!
              .estimation!.gasUsed
        }
        const provider = this.settings.providers[localAccountOp.networkId]
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
          this.settings.networks,
          localAccountOp.accountAddr,
          this.accountOpsToBeSigned[localAccountOp.accountAddr]
            ? Object.fromEntries(
                Object.entries(this.accountOpsToBeSigned[localAccountOp.accountAddr])
                  .filter(([, accOp]) => accOp)
                  .map(([networkId, x]) => [networkId, [x!.accountOp]])
              )
            : undefined,
          {
            forceUpdate: true
          }
        ),
        estimate(
          this.settings.providers[localAccountOp.networkId],
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
      // if the account op has been deleted from this.accountOpsToBeSigned,
      // don't continue as the request has already finished
      if (
        !this.accountOpsToBeSigned[localAccountOp.accountAddr] ||
        !this.accountOpsToBeSigned[localAccountOp.accountAddr][localAccountOp.networkId]
      )
        return

      // @race
      // we check this in the if statement above but in the event of a race which
      // deletes this.accountOpsToBeSigned just before coming here,
      // it's better an error to be thrown and caught instead of creating
      // a new entry in this.accountOpsToBeSigned. That's why we use "!" and we should
      // keep it that way
      this.accountOpsToBeSigned[localAccountOp.accountAddr][localAccountOp.networkId]!.accountOp =
        localAccountOp
      this.accountOpsToBeSigned[localAccountOp.accountAddr][localAccountOp.networkId]!.estimation =
        estimation

      // if the nonce from the estimation is different than the one in localAccountOp,
      // override all places that contain the old nonce with the correct one
      if (estimation && BigInt(estimation.currentAccountNonce) !== localAccountOp.nonce) {
        localAccountOp.nonce = BigInt(estimation.currentAccountNonce)

        this.accountOpsToBeSigned[localAccountOp.accountAddr][
          localAccountOp.networkId
        ]!.accountOp.nonce = localAccountOp.nonce

        if (
          this.accountStates[localAccountOp.accountAddr] &&
          this.accountStates[localAccountOp.accountAddr][localAccountOp.networkId]
        )
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
  async broadcastSignedAccountOp(accountOp: AccountOp) {
    this.broadcastStatus = 'LOADING'
    this.emitUpdate()

    if (!accountOp.signingKeyAddr || !accountOp.signingKeyType || !accountOp.signature) {
      return this.#throwAccountOpBroadcastError(new Error('AccountOp missing props'))
    }

    const provider = this.settings.providers[accountOp.networkId]
    const account = this.accounts.find((acc) => acc.addr === accountOp.accountAddr)
    const network = this.settings.networks.find((n) => n.id === accountOp.networkId)

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
    const estimation =
      this.accountOpsToBeSigned[accountOp.accountAddr][accountOp.networkId]!.estimation!
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
        } else {
          rawTxn.gasPrice = gasPrice
        }

        const signedTxn = await signer.signRawTransaction(rawTxn)
        transactionRes = await provider.broadcastTransaction(signedTxn)
      } catch (e: any) {
        let errorMsg = 'Please try again or contact support if the problem persists.'
        if (e?.message) {
          if (e.message.includes('insufficient funds')) {
            errorMsg = 'Insufficient funds for intristic transaction cost'
          } else {
            errorMsg = e.message.length > 200 ? `${e.message.substring(0, 200)}...` : e.message
          }
        }

        const message = `Failed to broadcast transaction on ${accountOp.networkId}: ${errorMsg}`
        return this.#throwAccountOpBroadcastError(new Error(message), message)
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
        const ambireFactory = new Interface(AmbireAccountFactory.abi)
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
        } else {
          rawTxn.gasPrice = gasPrice
        }

        const signedTxn = await signer.signRawTransaction(rawTxn)
        transactionRes = await provider.broadcastTransaction(signedTxn)
      } catch (e: any) {
        let errorMsg = 'Please try again or contact support if the problem persists.'
        if (e?.message) {
          if (e.message.includes('insufficient funds')) {
            errorMsg = 'Insufficient funds for intristic transaction cost'
          } else {
            errorMsg = e.message.length > 200 ? `${e.message.substring(0, 200)}...` : e.message
          }
        }

        const message = `Failed to broadcast transaction on ${accountOp.networkId}: ${errorMsg}`
        return this.#throwAccountOpBroadcastError(new Error(message), message)
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
      } catch (e) {
        return this.#throwAccountOpBroadcastError(new Error('bundler broadcast failed'))
      }
      if (!userOperationHash) {
        return this.#throwAccountOpBroadcastError(new Error('bundler broadcast failed'))
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
        return this.#throwAccountOpBroadcastError(e, e.message)
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
      await this.resolveAccountOp(
        {
          hash: transactionRes?.hash || null,
          networkId: network.id,
          isUserOp: !!accountOp?.asUserOperation
        },
        accountOp.accountAddr,
        accountOp.networkId
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
    await this.resolveUserRequest({ hash: signedMessage.signature }, signedMessage.id)
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

  async updateNetworkPreferences(
    networkPreferences: NetworkPreference,
    networkId: NetworkDescriptor['id']
  ) {
    await this.settings.updateNetworkPreferences(networkPreferences, networkId)

    if (networkPreferences?.rpcUrls) {
      await this.updateAccountStates('latest', [networkId])
      await this.updateSelectedAccount(this.selectedAccount, true)
    }
  }

  async resetNetworkPreference(
    preferenceKey: keyof NetworkPreference,
    networkId: NetworkDescriptor['id']
  ) {
    await this.settings.resetNetworkPreference(preferenceKey, networkId)

    if (preferenceKey === 'rpcUrls') {
      await this.updateAccountStates('latest', [networkId])
      await this.updateSelectedAccount(this.selectedAccount, true)
    }
  }

  // ! IMPORTANT !
  // Banners that depend on async data from sub-controllers should be implemented
  // in the sub-controllers themselves. This is because updates in the sub-controllers
  // will not trigger emitUpdate in the MainController, therefore the banners will
  // remain the same until a subsequent update in the MainController.
  get banners(): Banner[] {
    if (!this.selectedAccount) return []

    const accountOpBanners = getAccountOpBanners({
      accountOpsToBeSignedByNetwork: this.accountOpsToBeSigned[this.selectedAccount],
      selectedAccount: this.selectedAccount,
      userRequests:
        this.userRequests
          .filter((r) => r.action.kind === 'call')
          .filter((req) => req.meta.accountAddr === this.selectedAccount) || [],
      accounts: this.accounts,
      networks: this.settings.networks
    })

    return [...accountOpBanners]
  }

  #throwAccountOpBroadcastError(error: Error, message?: string) {
    this.emitError({
      level: 'major',
      message:
        message ||
        'Unable to send transaction. Please try again or contact Ambire support if the issue persists.',
      error
    })
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
