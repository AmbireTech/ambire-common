/* eslint-disable @typescript-eslint/brace-style */
import { ethers, TransactionResponse } from 'ethers'
import { NetworkPreference, NetworkPreferences } from 'interfaces/settings'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import { Account, AccountId, AccountOnchainState, AccountStates } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import {
  ExternalSignerControllers,
  Key,
  KeystoreSignerType,
  TxnRequest
} from '../../interfaces/keystore'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { Message, UserRequest } from '../../interfaces/userRequest'
import { getDefaultSelectedAccount, isSmartAccount } from '../../libs/account/account'
import { AccountOp, AccountOpStatus, getSignableCalls } from '../../libs/accountOp/accountOp'
import { Call as AccountOpCall } from '../../libs/accountOp/types'
import { getAccountState } from '../../libs/accountState/accountState'
import {
  getAccountOpBannersForEOA,
  getAccountOpBannersForSmartAccount,
  getMessageBanners,
  getNetworksWithFailedRPCBanners,
  getPendingAccountOpBannersForEOA
} from '../../libs/banners/banners'
import { estimate, EstimateResult } from '../../libs/estimate/estimate'
import { GasRecommendation, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { shouldGetAdditionalPortfolio } from '../../libs/portfolio/helpers'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { isErc4337Broadcast, toUserOperation } from '../../libs/userOperation/userOperation'
import bundler from '../../services/bundlers'
import generateSpoofSig from '../../utils/generateSpoofSig'
import wait from '../../utils/wait'
import { AccountAdderController } from '../accountAdder/accountAdder'
import { ActivityController, SignedMessage, SubmittedAccountOp } from '../activity/activity'
import { EmailVaultController } from '../emailVault'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import { SettingsController } from '../settings/settings'
/* eslint-disable no-underscore-dangle */
import { SignAccountOpController, SigningStatus } from '../signAccountOp/signAccountOp'
import { SignMessageController } from '../signMessage/signMessage'
import { TransferController } from '../transfer/transfer'

export class MainController extends EventEmitter {
  #storage: Storage

  #fetch: Function

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  #callRelayer: Function

  accountStates: AccountStates = {}

  isReady: boolean = false

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

  // Public sub-structures
  // @TODO emailVaults
  emailVault: EmailVaultController

  signMessage!: SignMessageController

  signAccountOp: SignAccountOpController | null = null

  signAccountOpListener: ReturnType<EventEmitter['onUpdate']> = () => {}

  signAccOpInitError: string | null = null

  activity!: ActivityController

  settings: SettingsController

  // @TODO read networks from settings
  accounts: Account[] = []

  selectedAccount: string | null = null

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

  // accountAddr => UniversalMessage[]
  messagesToBeSigned: { [key: string]: Message[] } = {}

  lastUpdate: Date = new Date()

  broadcastStatus: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  #relayerUrl: string

  onResolveDappRequest: (
    data: {
      hash: string | null
      networkId?: NetworkId
      isUserOp?: boolean
    },
    id?: number
  ) => void

  onRejectDappRequest: (err: any, id?: number) => void

  onUpdateDappSelectedAccount: (accountAddr: string) => void

  onBroadcastSuccess?: (type: 'message' | 'typed-data' | 'account-op') => void

  constructor({
    storage,
    fetch,
    relayerUrl,
    keystoreSigners,
    externalSignerControllers,
    onResolveDappRequest,
    onRejectDappRequest,
    onUpdateDappSelectedAccount,
    onBroadcastSuccess,
    pinned
  }: {
    storage: Storage
    fetch: Function
    relayerUrl: string
    keystoreSigners: Partial<{ [key in Key['type']]: KeystoreSignerType }>
    externalSignerControllers: ExternalSignerControllers
    onResolveDappRequest: (
      data: {
        hash: string | null
        networkId?: NetworkId
        isUserOp?: boolean
      },
      id?: number
    ) => void
    onRejectDappRequest: (err: any, id?: number) => void
    onUpdateDappSelectedAccount: (accountAddr: string) => void
    onBroadcastSuccess?: (type: 'message' | 'typed-data' | 'account-op') => void
    pinned: string[]
  }) {
    super()
    this.#storage = storage
    this.#fetch = fetch

    this.keystore = new KeystoreController(this.#storage, keystoreSigners)
    this.#externalSignerControllers = externalSignerControllers
    this.settings = new SettingsController(this.#storage)
    this.portfolio = new PortfolioController(
      this.#storage,
      this.settings.providers,
      relayerUrl,
      pinned
    )
    this.#initialLoadPromise = this.#load()
    this.emailVault = new EmailVaultController(
      this.#storage,
      this.#fetch,
      relayerUrl,
      this.keystore
    )
    this.accountAdder = new AccountAdderController({
      storage: this.#storage,
      relayerUrl,
      fetch: this.#fetch
    })
    this.transfer = new TransferController()
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch: this.#fetch })
    this.#relayerUrl = relayerUrl
    this.onResolveDappRequest = onResolveDappRequest
    this.onRejectDappRequest = onRejectDappRequest
    this.onUpdateDappSelectedAccount = onUpdateDappSelectedAccount
    this.onBroadcastSuccess = onBroadcastSuccess
    // @TODO Load userRequests from storage and emit that we have updated
    // @TODO
  }

  async #load(): Promise<void> {
    this.isReady = false
    this.emitUpdate()
    ;[this.accounts, this.selectedAccount] = await Promise.all([
      this.#storage.get('accounts', []),
      this.#storage.get('selectedAccount', null)
    ])
    // @TODO reload those
    // @TODO error handling here
    this.accountStates = await this.#getAccountsInfo(this.accounts)
    this.signMessage = new SignMessageController(
      this.keystore,
      this.settings,
      this.#externalSignerControllers,
      this.#storage,
      this.#fetch
    )
    this.activity = new ActivityController(this.#storage, this.accountStates, this.#relayerUrl)
    if (this.selectedAccount) {
      this.activity.init({ filters: { account: this.selectedAccount } })
    }

    const addReadyToAddAccountsAndKeysIfNeeded = async () => {
      if (this.accountAdder.addAccountsStatus !== 'SUCCESS') return

      await this.addAccounts(this.accountAdder.readyToAddAccounts)

      await this.keystore.addKeys(this.accountAdder.readyToAddKeys.internal)
      await this.keystore.addKeysExternallyStored(this.accountAdder.readyToAddKeys.external)

      await this.settings.addKeyPreferences(this.accountAdder.readyToAddKeyPreferences)

      const defaultSelectedAccount = getDefaultSelectedAccount(this.accountAdder.readyToAddAccounts)
      if (defaultSelectedAccount) await this.selectAccount(defaultSelectedAccount.addr)
    }
    this.accountAdder.onUpdate(addReadyToAddAccountsAndKeysIfNeeded)

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
      this.accounts,
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
    this.signAccountOpListener = this.signAccountOp.onUpdate(broadcastSignedAccountOpIfNeeded)

    this.emitUpdate()

    this.reestimateAndUpdatePrices(accountAddr, networkId)
  }

  destroySignAccOp() {
    this.signAccountOp = null
    this.signAccountOpListener() // unsubscribes for further updates
    this.emitUpdate()
  }

  async updateAccountsOpsStatuses() {
    await this.#initialLoadPromise

    const hasUpdatedStatuses = await this.activity.updateAccountsOpsStatuses()

    if (hasUpdatedStatuses) {
      this.emitUpdate()
    }
  }

  async #updateGasPrice() {
    await this.#initialLoadPromise

    // We want to update the gas price only for the networks having account ops.
    // Together with that, we make sure `ethereum` is included, as we always want to know its gas price (once we have a gas indicator, we will need it).
    const gasPriceNetworks = [
      ...new Set([
        ...Object.keys(this.accountOpsToBeSigned)
          .map((accountAddr) => Object.keys(this.accountOpsToBeSigned[accountAddr]))
          .flat(),
        'ethereum'
      ])
    ]

    await Promise.all(
      gasPriceNetworks.map(async (network) => {
        try {
          this.gasPrices[network] = await getGasPriceRecommendations(
            this.settings.providers[network],
            this.settings.networks.find((net) => net.id === network)!
          )
        } catch {
          this.emitError({
            level: 'major',
            message: `Failed to fetch gas price for ${
              this.settings.networks.find((n) => n.id === network)?.name
            }`,
            error: new Error('Failed to fetch gas price')
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
    this.accountStates = await this.#getAccountsInfo(this.accounts, blockTag, networks)
    this.lastUpdate = new Date()
    this.emitUpdate()
  }

  async selectAccount(toAccountAddr: string) {
    await this.#initialLoadPromise

    if (!this.accounts.find((acc) => acc.addr === toAccountAddr)) {
      // TODO: error handling, trying to switch to account that does not exist
      return
    }

    this.selectedAccount = toAccountAddr
    await this.#storage.set('selectedAccount', toAccountAddr)
    this.activity.init({ filters: { account: toAccountAddr } })
    this.updateSelectedAccount(toAccountAddr)
    this.onUpdateDappSelectedAccount(toAccountAddr)
    this.emitUpdate()
  }

  async addAccounts(accounts: Account[] = []) {
    if (!accounts.length) return

    const alreadyAddedAddressSet = new Set(this.accounts.map((account) => account.addr))
    const newAccounts = accounts.filter((account) => !alreadyAddedAddressSet.has(account.addr))

    if (!newAccounts.length) return

    const nextAccounts = [...this.accounts, ...newAccounts]
    await this.#storage.set('accounts', nextAccounts)
    this.accounts = nextAccounts
    this.updateAccountStates()

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
    const calls = this.userRequests.reduce((uCalls: AccountOpCall[], req) => {
      // only the first one for EOAs
      if (!account.creation && uCalls.length > 0) return uCalls

      if (
        req.action.kind === 'call' &&
        req.networkId === networkId &&
        req.accountAddr === accountAddr
      ) {
        const { to, value, data } = req.action
        uCalls.push({ to, value, data, fromUserRequestId: req.id })
      }
      return uCalls
    }, [])

    if (!calls.length) return null

    const currentAccountOp = this.accountOpsToBeSigned[accountAddr][networkId]?.accountOp

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

    this.portfolio.updateSelectedAccount(
      this.accounts,
      this.settings.networks,
      selectedAccount,
      undefined,
      { forceUpdate }
    )

    const account = this.accounts.find(({ addr }) => addr === selectedAccount)
    if (shouldGetAdditionalPortfolio(account))
      this.portfolio.getAdditionalPortfolio(selectedAccount)
  }

  async addUserRequest(req: UserRequest) {
    this.userRequests.push(req)
    const { id, action, accountAddr, networkId } = req
    if (!this.settings.networks.find((x) => x.id === networkId))
      throw new Error(`addUserRequest: ${networkId}: network does not exist`)
    if (action.kind === 'call') {
      // @TODO: if EOA, only one call per accountOp
      if (!this.accountOpsToBeSigned[accountAddr]) this.accountOpsToBeSigned[accountAddr] = {}
      // @TODO
      // one solution would be to, instead of checking, have a promise that we always await here, that is responsible for fetching
      // account data; however, this won't work with EOA accountOps, which have to always pick the first userRequest for a particular acc/network,
      // and be recalculated when one gets dismissed
      // although it could work like this: 1) await the promise, 2) check if exists 3) if not, re-trigger the promise;
      // 4) manage recalc on removeUserRequest too in order to handle EOAs
      // @TODO consider re-using this whole block in removeUserRequest
      await this.#ensureAccountInfo(accountAddr, networkId)

      if (this.signAccOpInitError) return

      const accountOp = this.#makeAccountOpFromUserRequests(accountAddr, networkId)
      if (accountOp) {
        this.accountOpsToBeSigned[accountAddr][networkId] = { accountOp, estimation: null }
        try {
          await this.#estimateAccountOp(accountOp)
        } catch (e) {
          // @TODO: unified wrapper for controller errors
          console.error(e)
        }
      }
    } else {
      if (!this.messagesToBeSigned[accountAddr]) this.messagesToBeSigned[accountAddr] = []
      if (this.messagesToBeSigned[accountAddr].find((x) => x.fromUserRequestId === req.id)) return
      this.messagesToBeSigned[accountAddr].push({
        id,
        content: action,
        fromUserRequestId: req.id,
        signature: null,
        accountAddr,
        networkId
      })
    }
    this.emitUpdate()
  }

  // @TODO allow this to remove multiple OR figure out a way to debounce re-estimations
  // first one sounds more reasonble
  // although the second one can't hurt and can help (or no debounce, just a one-at-a-time queue)
  async removeUserRequest(id: number) {
    const req = this.userRequests.find((uReq) => uReq.id === id)
    if (!req) return

    // remove from the request queue
    this.userRequests.splice(this.userRequests.indexOf(req), 1)

    // update the pending stuff to be signed
    const { action, accountAddr, networkId } = req
    if (action.kind === 'call') {
      // @TODO ensure acc info, re-estimate
      const accountOp = this.#makeAccountOpFromUserRequests(accountAddr, networkId)
      if (accountOp) {
        this.accountOpsToBeSigned[accountAddr][networkId] = { accountOp, estimation: null }
        try {
          await this.#estimateAccountOp(accountOp)
        } catch (e) {
          // @TODO: unified wrapper for controller errors
          console.error(e)
        }
      } else {
        delete this.accountOpsToBeSigned[accountAddr][networkId]
        if (!Object.keys(this.accountOpsToBeSigned[accountAddr] || {}).length)
          delete this.accountOpsToBeSigned[accountAddr]
      }
    } else {
      this.messagesToBeSigned[accountAddr] = this.messagesToBeSigned[accountAddr].filter(
        (x) => x.fromUserRequestId !== id
      )
      if (!Object.keys(this.messagesToBeSigned[accountAddr] || {}).length)
        delete this.messagesToBeSigned[accountAddr]
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

    await Promise.all([
      this.#updateGasPrice(),
      async () => {
        const accountOp = this.accountOpsToBeSigned[accountAddr][networkId]?.accountOp
        // non-fatal, no need to do anything
        if (!accountOp) return

        await this.#estimateAccountOp(accountOp)
      }
    ])

    const gasPrices = this.gasPrices[networkId]
    const estimation = this.accountOpsToBeSigned[accountAddr][networkId]?.estimation

    this.signAccountOp.update({ gasPrices, ...(estimation && { estimation }) })
    this.emitUpdate()
  }

  // @TODO: protect this from race conditions/simultanous executions
  async #estimateAccountOp(accountOp: AccountOp) {
    await this.#initialLoadPromise
    // new accountOps should have spoof signatures so that they can be easily simulated
    // this is not used by the Estimator, because it iterates through all associatedKeys and
    // it knows which ones are authenticated, and it can generate it's own spoofSig
    // @TODO
    // accountOp.signature = `${}03`

    // TODO check if needed data in accountStates are available
    // this.accountStates[accountOp.accountAddr][accountOp.networkId].
    const account = this.accounts.find((x) => x.addr === accountOp.accountAddr)

    // Here, we list EOA accounts for which you can also obtain an estimation of the AccountOp payment.
    // In the case of operating with a smart account (an account with creation code), all other EOAs can pay the fee.
    //
    // If the current account is an EOA, only this account can pay the fee,
    // and there's no need for checking other EOA accounts native balances.
    // This is already handled and estimated as a fee option in the estimate library, which is why we pass an empty array here.
    const EOAaccounts = account?.creation ? this.accounts.filter((acc) => !acc.creation) : []
    const feeTokens =
      this.portfolio.latest?.[accountOp.accountAddr]?.[accountOp.networkId]?.result?.tokens
        .filter((t) => t.flags.isFeeToken)
        .map((token) => token.address) || []

    if (!account)
      throw new Error(`estimateAccountOp: ${accountOp.accountAddr}: account does not exist`)
    const network = this.settings.networks.find((x) => x.id === accountOp.networkId)
    if (!network)
      throw new Error(`estimateAccountOp: ${accountOp.networkId}: network does not exist`)

    // start transforming the accountOp to userOp if the network is 4337
    // and it's not a legacy account
    const is4337Broadcast = isErc4337Broadcast(
      network,
      this.accountStates[accountOp.accountAddr][accountOp.networkId]
    )
    if (is4337Broadcast) {
      accountOp = toUserOperation(
        account,
        this.accountStates[accountOp.accountAddr][accountOp.networkId],
        accountOp
      )
    }
    const [, , estimation] = await Promise.all([
      // NOTE: we are not emitting an update here because the portfolio controller will do that
      // NOTE: the portfolio controller has it's own logic of constructing/caching providers, this is intentional, as
      // it may have different needs
      this.portfolio.updateSelectedAccount(
        this.accounts,
        this.settings.networks,
        accountOp.accountAddr,
        Object.fromEntries(
          Object.entries(this.accountOpsToBeSigned[accountOp.accountAddr])
            .filter(([, accOp]) => accOp)
            .map(([networkId, x]) => [networkId, [x!.accountOp]])
        )
      ),
      shouldGetAdditionalPortfolio(account) &&
        this.portfolio.getAdditionalPortfolio(accountOp.accountAddr),
      estimate(
        this.settings.providers[accountOp.networkId],
        network,
        account,
        accountOp,
        this.accountStates[accountOp.accountAddr][accountOp.networkId],
        EOAaccounts.map((acc) => acc.addr),
        // @TODO - first time calling this, portfolio is still not loaded.
        feeTokens,
        { is4337Broadcast }
      ).catch((e) => {
        this.emitError({
          level: 'major',
          message: `Failed to estimate account op for ${accountOp.accountAddr} on ${accountOp.networkId}`,
          error: e
        })

        return null
      })
    ])

    if (!estimation) return
    // @TODO compare intent between accountOp and this.accountOpsToBeSigned[accountOp.accountAddr][accountOp.networkId].accountOp
    this.accountOpsToBeSigned[accountOp.accountAddr][accountOp.networkId]!.estimation = estimation

    // add the estimation to the user operation
    if (is4337Broadcast) {
      accountOp.asUserOperation!.verificationGasLimit = ethers.toBeHex(
        estimation.erc4337estimation!.verificationGasLimit
      )
      accountOp.asUserOperation!.callGasLimit = ethers.toBeHex(
        estimation.erc4337estimation!.callGasLimit
      )
      this.accountOpsToBeSigned[accountOp.accountAddr][accountOp.networkId]!.accountOp = accountOp
    }
  }

  /**
   * There are 4 ways to broadcast an AccountOp:
   *   1. For legacy accounts (EOA), there is only one way to do that. After
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
        option.address === accountOp.gasFeePayment?.inToken &&
        option.paidBy === accountOp.gasFeePayment?.paidBy
    )!

    // Legacy account (EOA)
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
        if (gasFeePayment.maxPriorityFeePerGas) {
          rawTxn.maxFeePerGas = gasPrice
          rawTxn.maxPriorityFeePerGas = gasFeePayment.maxPriorityFeePerGas
        } else {
          rawTxn.gasPrice = gasPrice
        }

        const signedTxn = await signer.signRawTransaction(rawTxn)
        transactionRes = await provider.broadcastTransaction(signedTxn)
      } catch (e: any) {
        const errorMsg =
          e?.message || 'Please try again or contact support if the problem persists.'
        const message = `Failed to broadcast transaction on ${accountOp.networkId}. ${errorMsg}`

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
        const ambireAccount = new ethers.Interface(AmbireAccount.abi)
        to = accountOp.accountAddr
        data = ambireAccount.encodeFunctionData('execute', [
          getSignableCalls(accountOp),
          accountOp.signature
        ])
      } else {
        const ambireFactory = new ethers.Interface(AmbireAccountFactory.abi)
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

        if (accountOp.gasFeePayment.maxPriorityFeePerGas) {
          rawTxn.maxFeePerGas = gasPrice
          rawTxn.maxPriorityFeePerGas = accountOp.gasFeePayment.maxPriorityFeePerGas
        } else {
          rawTxn.gasPrice = gasPrice
        }

        const signedTxn = await signer.signRawTransaction(rawTxn)
        transactionRes = await provider.broadcastTransaction(signedTxn)
      } catch (e: any) {
        const errorMsg =
          e?.message || 'Please try again or contact support if the problem persists.'
        const message = `Failed to broadcast transaction on ${accountOp.networkId}. ${errorMsg}`
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
      const userOperationHash = await bundler.broadcast(userOperation!, network!)
      if (!userOperationHash) {
        return this.#throwAccountOpBroadcastError(new Error('was not able to broadcast'))
      }
      // broadcast the userOperationHash
      // TODO: maybe a type property should exist to diff when we're
      // returning a tx id and when an user op hash
      transactionRes = {
        hash: userOperationHash,
        nonce: Number(userOperation!.nonce)
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

        if (response.success) {
          transactionRes = {
            hash: response.txId,
            nonce: Number(accountOp.nonce)
          }
        } else {
          return this.#throwAccountOpBroadcastError(new Error(response.message))
        }
      } catch (e: any) {
        return this.#throwAccountOpBroadcastError(e, e.message)
      }
    }

    if (transactionRes) {
      await this.activity.addAccountOp({
        ...accountOp,
        status: AccountOpStatus.BroadcastedButNotConfirmed,
        txnId: transactionRes.hash,
        nonce: BigInt(transactionRes.nonce),
        timestamp: new Date().getTime()
      } as SubmittedAccountOp)
      accountOp.calls.forEach((call) => {
        if (call.fromUserRequestId) {
          this.removeUserRequest(call.fromUserRequestId)
          this.onResolveDappRequest(
            {
              hash: transactionRes?.hash || null,
              networkId: network.id,
              isUserOp: !!accountOp?.asUserOperation
            },
            call.fromUserRequestId
          )
        }
      })
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
    this.removeUserRequest(signedMessage.id)
    this.onResolveDappRequest({ hash: signedMessage.signature }, signedMessage.id)
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
    networkPreferences: NetworkPreferences,
    networkId: NetworkDescriptor['id']
  ) {
    await this.settings.updateNetworkPreferences(networkPreferences, networkId)

    if (networkPreferences?.rpcUrl) {
      await this.updateAccountStates('latest', [networkId])
      await this.updateSelectedAccount(this.selectedAccount, true)
    }
  }

  async resetNetworkPreference(
    preferenceKey: keyof NetworkPreference,
    networkId: NetworkDescriptor['id']
  ) {
    await this.settings.resetNetworkPreference(preferenceKey, networkId)

    if (preferenceKey === 'rpcUrl') {
      await this.updateAccountStates('latest', [networkId])
      await this.updateSelectedAccount(this.selectedAccount, true)
    }
  }

  get banners(): Banner[] {
    const userRequests =
      this.userRequests.filter((req) => req.accountAddr === this.selectedAccount) || []
    const accounts = this.accounts
    const accountOpEOABanners = getAccountOpBannersForEOA({ userRequests, accounts })
    const pendingAccountOpEOABanners = getPendingAccountOpBannersForEOA({ userRequests, accounts })
    const accountOpSmartAccountBanners = getAccountOpBannersForSmartAccount({
      userRequests,
      accounts
    })
    const messageBanners = getMessageBanners({ userRequests })
    const networksWithFailedRPCBanners = getNetworksWithFailedRPCBanners({
      providers: this.settings.providers,
      networks: this.settings.networks,
      networksWithAssets: this.portfolio.networksWithAssets
    })

    return [
      ...accountOpSmartAccountBanners,
      ...accountOpEOABanners,
      ...pendingAccountOpEOABanners,
      ...messageBanners,
      ...this.activity.banners,
      ...networksWithFailedRPCBanners
    ]
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
      banners: this.banners
    }
  }
}
