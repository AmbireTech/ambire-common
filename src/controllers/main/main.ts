import { ethers, JsonRpcProvider, TransactionResponse } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import { networks } from '../../consts/networks'
import { Account, AccountId, AccountStates } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { Key, KeystoreSignerType } from '../../interfaces/keystore'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { Message, UserRequest } from '../../interfaces/userRequest'
import { AccountOp, Call as AccountOpCall, callToTuple } from '../../libs/accountOp/accountOp'
import { getAccountState } from '../../libs/accountState/accountState'
import {
  getAccountOpBannersForEOA,
  getAccountOpBannersForSmartAccount,
  getMessageBanners,
  getPendingAccountOpBannersForEOA
} from '../../libs/banners/banners'
import { estimate, EstimateResult } from '../../libs/estimate/estimate'
import { GasRecommendation, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { shouldGetAdditionalPortfolio } from '../../libs/portfolio/helpers'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import generateSpoofSig from '../../utils/generateSpoofSig'
import { AccountAdderController } from '../accountAdder/accountAdder'
import { ActivityController } from '../activity/activity'
import { EmailVaultController } from '../emailVault'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
/* eslint-disable no-underscore-dangle */
import { SignAccountOpController } from '../signAccountOp/signAccountOp'
import { SignMessageController } from '../signMessage/signMessage'
import { TransferController } from '../transfer/transfer'

export class MainController extends EventEmitter {
  #storage: Storage

  #fetch: Function

  #providers: { [key: string]: JsonRpcProvider } = {}

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  #callRelayer: Function

  accountStates: AccountStates = {}

  isReady: boolean = false

  keystore: KeystoreController

  accountAdder: AccountAdderController

  // Subcontrollers
  portfolio: PortfolioController

  transfer: TransferController

  // Public sub-structures
  // @TODO emailVaults
  emailVault: EmailVaultController

  signMessage!: SignMessageController

  signAccountOp!: SignAccountOpController

  activity!: ActivityController

  // @TODO read networks from settings
  accounts: Account[] = []

  selectedAccount: string | null = null

  // @TODO: structure
  settings: { networks: NetworkDescriptor[] }

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

  onResolveDappRequest: (data: any, id?: number) => void

  onRejectDappRequest: (err: any, id?: number) => void

  onUpdateDappSelectedAccount: (accountAddr: string) => void

  onBroadcastSuccess?: (type: 'message' | 'typed-data' | 'account-op') => void

  constructor({
    storage,
    fetch,
    relayerUrl,
    keystoreSigners,
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
    onResolveDappRequest: (data: any, id?: number) => void
    onRejectDappRequest: (err: any, id?: number) => void
    onUpdateDappSelectedAccount: (accountAddr: string) => void
    onBroadcastSuccess?: (type: 'message' | 'typed-data' | 'account-op') => void
    pinned: string[]
  }) {
    super()
    this.#storage = storage
    this.#fetch = fetch

    this.portfolio = new PortfolioController(this.#storage, relayerUrl, pinned)
    this.keystore = new KeystoreController(this.#storage, keystoreSigners)
    this.settings = { networks }
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
    this.#providers = Object.fromEntries(
      this.settings.networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
    )
    // @TODO reload those
    // @TODO error handling here
    this.accountStates = await this.#getAccountsInfo(this.accounts)
    this.signMessage = new SignMessageController(
      this.keystore,
      this.#providers,
      this.#storage,
      this.#fetch
    )
    this.signAccountOp = new SignAccountOpController(
      this.keystore,
      this.portfolio,
      this.#storage,
      this.#fetch,
      this.#providers
    )
    this.activity = new ActivityController(this.#storage, this.accountStates)

    const addReadyToAddAccountsIfNeeded = () => {
      if (
        !this.accountAdder.readyToAddAccounts.length &&
        this.accountAdder.addAccountsStatus !== 'SUCCESS'
      )
        return

      this.addAccounts(this.accountAdder.readyToAddAccounts)
    }
    this.accountAdder.onUpdate(addReadyToAddAccountsIfNeeded)

    this.isReady = true
    this.emitUpdate()
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
        this.gasPrices[network] = await getGasPriceRecommendations(this.#providers[network])
      })
    )
  }

  async #getAccountsInfo(accounts: Account[]): Promise<AccountStates> {
    const result = await Promise.all(
      this.settings.networks.map((network) =>
        getAccountState(this.#providers[network.id], network, accounts)
      )
    )

    const states = accounts.map((acc: Account, accIndex: number) => {
      return [
        acc.addr,
        Object.fromEntries(
          this.settings.networks.map((network: NetworkDescriptor, netIndex: number) => {
            return [network.id, result[netIndex][accIndex]]
          })
        )
      ]
    })

    return Object.fromEntries(states)
  }

  async updateAccountStates() {
    this.accountStates = await this.#getAccountsInfo(this.accounts)
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

    this.emitUpdate()
  }

  async #ensureAccountInfo(accountAddr: AccountId, networkId: NetworkId) {
    await this.#initialLoadPromise
    // Initial sanity check: does this account even exist?
    if (!this.accounts.find((x) => x.addr === accountAddr))
      throw new Error(`ensureAccountInfo: called for non-existant acc ${accountAddr}`)
    // If this still didn't work, re-load
    // @TODO: should we re-start the whole load or only specific things?
    if (!this.accountStates[accountAddr]?.[networkId])
      await (this.#initialLoadPromise = this.#load())
    // If this still didn't work, throw error: this prob means that we're calling for a non-existant acc/network
    if (!this.accountStates[accountAddr]?.[networkId])
      throw new Error(
        `ensureAccountInfo: acc info for ${accountAddr} on ${networkId} was not retrieved`
      )
  }

  #makeAccountOpFromUserRequests(accountAddr: AccountId, networkId: NetworkId): AccountOp | null {
    const account = this.accounts.find((x) => x.addr === accountAddr)
    if (!account)
      throw new Error(
        `makeAccountOpFromUserRequests: tried to run for non-existant account ${accountAddr}`
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

    const accAvailableKeys = this.keystore.keys.filter((key) =>
      account.associatedKeys.includes(key.addr)
    )

    if (!calls.length || !accAvailableKeys.length) return null

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
      signature: generateSpoofSig(accAvailableKeys[0].addr),
      // @TODO from pending recoveries
      accountOpToExecuteBefore: null,
      calls
    }
  }

  async updateSelectedAccount(selectedAccount: string | null = null) {
    if (!selectedAccount) return
    this.portfolio.updateSelectedAccount(this.accounts, this.settings.networks, selectedAccount)

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
    const otherEOAaccounts = this.accounts.filter(
      (acc) => !acc.creation && acc.addr !== accountOp.accountAddr
    )
    const feeTokens =
      this.portfolio.latest?.[accountOp.accountAddr]?.[accountOp.networkId]?.result?.tokens
        .filter((t) => t.flags.isFeeToken)
        .map((token) => token.address) || []

    if (!account)
      throw new Error(`estimateAccountOp: ${accountOp.accountAddr}: account does not exist`)
    const network = this.settings.networks.find((x) => x.id === accountOp.networkId)
    if (!network)
      throw new Error(`estimateAccountOp: ${accountOp.networkId}: network does not exist`)
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
        this.#providers[accountOp.networkId],
        network,
        account,
        accountOp,
        otherEOAaccounts.map((acc) => acc.addr),
        // @TODO - first time calling this, portfolio is still not loaded.
        feeTokens
      )
    ])
    // @TODO compare intent between accountOp and this.accountOpsToBeSigned[accountOp.accountAddr][accountOp.networkId].accountOp
    this.accountOpsToBeSigned[accountOp.accountAddr][accountOp.networkId]!.estimation = estimation
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, class-methods-use-this
  async broadcastSignedAccountOp(accountOp: AccountOp) {
    if (!accountOp.signingKeyAddr || !accountOp.signingKeyType || !accountOp.signature) {
      this.#throwAccountOpBroadcastError(new Error('AccountOp missing props'))
      return
    }

    const provider: JsonRpcProvider = this.#providers[accountOp.networkId]
    const account = this.accounts.find((acc) => acc.addr === accountOp.accountAddr)

    if (!provider) {
      this.#throwAccountOpBroadcastError(
        new Error(`Provider for networkId: ${accountOp.networkId} not found`)
      )
      return
    }

    if (!account) {
      this.#throwAccountOpBroadcastError(
        new Error(`Account with address: ${accountOp.accountAddr} not found`)
      )
      return
    }

    let transactionRes: TransactionResponse | {hash: string, nonce: number} | null = null

    // EOA account
    if (!account.creation) {
      try {
        transactionRes = await provider.broadcastTransaction(accountOp.signature)
      } catch (error: any) {
        this.#throwAccountOpBroadcastError(new Error(error))
      }
    }
    // Smart account but EOA pays the fee
    else if (
      account.creation &&
      accountOp.gasFeePayment &&
      accountOp.gasFeePayment.paidBy !== account.addr
    ) {
      const estimation =
        this.accountOpsToBeSigned[accountOp.accountAddr][accountOp.networkId]!.estimation
      if (!estimation) {
        this.#throwAccountOpBroadcastError(
          new Error(`Estimation not done for account with address: ${accountOp.accountAddr}`)
        )
      }

      const accountState = this.accountStates[accountOp.accountAddr][accountOp.networkId]
      let data
      let to
      if (accountState.isDeployed) {
        const ambireAccount = new ethers.Interface(AmbireAccount.abi)
        to = accountOp.accountAddr
        data = ambireAccount.encodeFunctionData('execute', [
          accountOp.calls.map((call) => callToTuple(call)),
          accountOp.signature
        ])
      } else {
        const ambireFactory = new ethers.Interface(AmbireAccountFactory.abi)
        to = account.creation.factoryAddr
        data = ambireFactory.encodeFunctionData('deployAndExecute', [
          account.creation.bytecode,
          account.creation.salt,
          accountOp.calls.map((call) => callToTuple(call)),
          accountOp.signature
        ])
      }

      const signer = await this.keystore.getSigner(
        accountOp.signingKeyAddr,
        accountOp.signingKeyType
      )
      const signedTxn = await signer.signRawTransaction({
        to,
        data,
        chainId: this.settings.networks.filter(net => net.id == accountOp.networkId)[0].chainId,
        nonce: await provider.getTransactionCount(accountOp.signingKeyAddr),
        // TODO: fix simulatedGasLimit as multiplying by 2 is just
        // a quick fix
        gasLimit: accountOp.gasFeePayment.simulatedGasLimit * 2n,
        gasPrice:
          (accountOp.gasFeePayment.amount - estimation!.addedNative) /
          accountOp.gasFeePayment.simulatedGasLimit
      })

      try {
        transactionRes = await provider.broadcastTransaction(signedTxn)
      } catch (error: any) {
        this.#throwAccountOpBroadcastError(new Error(error))
      }
    }
    // TO DO: ERC-4337 broadcast
    else if (accountOp.gasFeePayment && accountOp.gasFeePayment.isERC4337) {

    }
    // Relayer broadcast
    else {
      try {
        const response = await this.#callRelayer(
          `/identity/${accountOp.accountAddr}/${accountOp.networkId}/submit`,
          'POST',
          {
            gasLimit: accountOp.gasFeePayment!.simulatedGasLimit * 2n,
            txns: accountOp.calls.map((call) => callToTuple(call)),
            signature: accountOp.signature,
            signer: {
                address: accountOp.signingKeyAddr,
            },
            nonce: accountOp.nonce,
          }
        )
        if (response.data.success) {
          // not sure which should be the correct nonce here
          // we don't have information on the one that's from the relayer
          // unless we strictly call the RPC
          // and calling the RPC here is not the best as our RPC might not
          // be up-to-date
          transactionRes = {
            hash: response.data.txId,
            nonce: parseInt(accountOp.nonce!.toString())
          }
        } else {
          this.#throwAccountOpBroadcastError(new Error(response.data.message))
        }
      } catch (e: any) {
        this.#throwAccountOpBroadcastError(e)
      }
    }

    if (transactionRes) {
      this.activity.addAccountOp({
        ...accountOp,
        txnId: transactionRes.hash,
        nonce: BigInt(transactionRes.nonce)
      })
      accountOp.calls.forEach((call) => {
        if (call.fromUserRequestId) {
          this.removeUserRequest(call.fromUserRequestId)
          this.onResolveDappRequest({ hash: accountOp.signature }, call.fromUserRequestId)
        }
      })
      console.log('broadcasted:', transactionRes)
      !!this.onBroadcastSuccess && this.onBroadcastSuccess('account-op')
      // TODO: impl "benzina"
      this.emitUpdate()
    }
  }

  broadcastSignedMessage(signedMessage: Message) {
    this.activity.addSignedMessage(signedMessage, signedMessage.accountAddr)
    this.removeUserRequest(signedMessage.id)
    this.onResolveDappRequest({ hash: signedMessage.signature }, signedMessage.id)
    !!this.onBroadcastSuccess &&
      this.onBroadcastSuccess(
        signedMessage.content.kind === 'typedMessage' ? 'typed-data' : 'message'
      )
    this.emitUpdate()
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

    return [
      ...accountOpSmartAccountBanners,
      ...accountOpEOABanners,
      ...pendingAccountOpEOABanners,
      ...messageBanners
    ]
  }

  #throwAccountOpBroadcastError(error: Error) {
    this.emitError({
      level: 'major',
      message:
        'Unable to send transaction. Please try again or contact Ambire support if the issue persists.',
      error
    })
  }

  // includes the getters in the stringified instance
  toJSON() {
    return {
      ...this,
      banners: this.banners
    }
  }
}
