import { ZeroAddress } from 'ethers'
/* eslint-disable import/no-extraneous-dependencies */
import fetch from 'node-fetch'

import { Account, AccountId } from '../../interfaces/account'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
/* eslint-disable @typescript-eslint/no-shadow */
import { Storage } from '../../interfaces/storage'
import { isSmartAccount } from '../../libs/account/account'
import { AccountOp, isAccountOpsIntentEqual } from '../../libs/accountOp/accountOp'
/* eslint-disable no-restricted-syntax */
// eslint-disable-next-line import/no-cycle
import {
  getNetworksWithFailedRPCBanners,
  getNetworksWithPortfolioErrorBanners
} from '../../libs/banners/banners'
/* eslint-disable @typescript-eslint/no-use-before-define */
import { CustomToken } from '../../libs/portfolio/customToken'
import getAccountNetworksWithAssets from '../../libs/portfolio/getNetworksWithAssets'
import {
  getFlags,
  getPinnedGasTankTokens,
  getTotal,
  getUpdatedHints,
  shouldGetAdditionalPortfolio,
  tokenFilter,
  validateERC20Token
} from '../../libs/portfolio/helpers'
/* eslint-disable no-param-reassign */
/* eslint-disable import/no-extraneous-dependencies */
import {
  AccountState,
  ExternalHintsAPIResponse,
  GetOptions,
  PortfolioControllerState,
  PortfolioLibGetResult,
  PreviousHintsStorage,
  TokenResult
} from '../../libs/portfolio/interfaces'
import { Portfolio } from '../../libs/portfolio/portfolio'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import EventEmitter from '../eventEmitter/eventEmitter'
/* eslint-disable @typescript-eslint/no-shadow */
import { SettingsController } from '../settings/settings'

const LEARNED_TOKENS_NETWORK_LIMIT = 50

export class PortfolioController extends EventEmitter {
  latest: PortfolioControllerState

  pending: PortfolioControllerState

  tokenPreferences: CustomToken[] = []

  validTokens: any = { erc20: {}, erc721: {} }

  temporaryTokens: {
    [networkId: NetworkDescriptor['id']]: {
      isLoading: boolean
      errors: { error: string; address: string }[]
      result: { tokens: PortfolioLibGetResult['tokens'] }
    }
  } = {}

  #portfolioLibs: Map<string, Portfolio>

  #storage: Storage

  #callRelayer: Function

  #networksWithAssetsByAccounts: {
    [accountId: string]: NetworkDescriptor['id'][]
  } = {}

  #minUpdateInterval: number = 20000 // 20 seconds

  #previousHints: PreviousHintsStorage = {
    fromExternalAPI: {},
    learnedTokens: {}
  }

  #settings: SettingsController

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  constructor(storage: Storage, settings: SettingsController, relayerUrl: string) {
    super()
    this.latest = {}
    this.pending = {}
    this.#portfolioLibs = new Map()
    this.#storage = storage
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.#settings = settings
    this.temporaryTokens = {}

    this.#initialLoadPromise = this.#load()
  }

  async #load() {
    try {
      this.tokenPreferences = await this.#storage.get('tokenPreferences', [])
      this.#previousHints = await this.#storage.get('previousHints', {})
    } catch (e) {
      this.emitError({
        message:
          'Something went wrong when loading portfolio. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('portfolio: failed to pull keys from storage')
      })
    }

    this.emitUpdate()
  }

  async updateTokenPreferences(tokenPreferences: CustomToken[]) {
    this.tokenPreferences = tokenPreferences
    this.emitUpdate()
    await this.#storage.set('tokenPreferences', tokenPreferences)
  }

  async #updateNetworksWithAssets(
    accounts: Account[],
    accountId: AccountId,
    accountState: AccountState
  ) {
    const storageStateByAccount = await this.#storage.get('networksWithAssetsByAccount', {})

    // On the first run
    if (Object.keys(this.#networksWithAssetsByAccounts).length === 0) {
      // Remove old accounts from storage
      const storageAccounts = Object.keys(storageStateByAccount)
      const currentAccounts = accounts.map(({ addr }) => addr)
      const accountsToRemove = storageAccounts.filter((x) => !currentAccounts.includes(x))

      for (const account of accountsToRemove) {
        delete storageStateByAccount[account]
      }

      // Set the initial state
      this.#networksWithAssetsByAccounts = storageStateByAccount
    }

    this.#networksWithAssetsByAccounts[accountId] = getAccountNetworksWithAssets(
      accountId,
      accountState,
      storageStateByAccount,
      this.#settings.providers
    )

    this.emitUpdate()
    await this.#storage.set('networksWithAssetsByAccount', this.#networksWithAssetsByAccounts)
  }

  // gets additional portfolio state from the relayer that isn't retrieved from the portfolio library
  // that's usually the two additional virtual networks: getTank and rewards
  #setNetworkLoading(accountId: AccountId, network: string, isLoading: boolean, error?: any) {
    const accountState = this.latest[accountId]
    if (!accountState[network]) accountState[network] = { errors: [], isReady: false, isLoading }
    accountState[network]!.isLoading = isLoading
    if (!error) {
      if (!accountState[network]!.isReady) accountState[network]!.criticalError = error
      else accountState[network]!.errors.push(error)
    }
  }

  #prepareLatestState(selectedAccount: Account, networks: NetworkDescriptor[]) {
    const state = this.latest
    const accountId = selectedAccount.addr

    if (!state[accountId]) {
      state[accountId] = networks.reduce((acc: AccountState, network) => {
        acc[network.id] = { isReady: false, isLoading: false, errors: [] }

        return acc
      }, {} as AccountState)

      if (shouldGetAdditionalPortfolio(selectedAccount)) {
        state[accountId].gasTank = { isReady: false, isLoading: false, errors: [] }
        state[accountId].rewards = { isReady: false, isLoading: false, errors: [] }
      }

      this.emitUpdate()
      return
    }

    const accountState = state[accountId]
    // Remove networks that are not in the list of networks. For example:
    // If the user adds a custom network, the portfolio fetches assets for it but the user
    // removes the network, the portfolio should remove the assets for that network.
    for (const networkId of Object.keys(accountState)) {
      if (![...networks, { id: 'gasTank' }, { id: 'rewards' }].find((x) => x.id === networkId))
        delete accountState[networkId]
    }
    this.emitUpdate()
  }

  #preparePendingState(selectedAccountId: AccountId, networks: NetworkDescriptor[]) {
    if (!this.pending[selectedAccountId]) {
      this.pending[selectedAccountId] = {}
      this.emitUpdate()
      return
    }

    const accountState = this.pending[selectedAccountId]
    // Remove networks that are not in the list of networks. For example:
    // If the user adds a custom network, the portfolio fetches assets for it but the user
    // removes the network, the portfolio should remove the assets for that network.
    for (const networkId of Object.keys(accountState)) {
      if (![...networks, { id: 'gasTank' }, { id: 'rewards' }].find((x) => x.id === networkId))
        delete accountState[networkId]
    }
    this.emitUpdate()
  }

  // make the pending results the same as the latest ones
  async overridePendingResults(accountOp: AccountOp) {
    if (
      this.pending[accountOp.accountAddr] &&
      this.pending[accountOp.accountAddr][accountOp.networkId] &&
      this.latest[accountOp.accountAddr] &&
      this.latest[accountOp.accountAddr][accountOp.networkId]
    ) {
      this.pending[accountOp.accountAddr][accountOp.networkId]!.result =
        this.latest[accountOp.accountAddr][accountOp.networkId]!.result
      this.emitUpdate()
    }
  }

  async updateTokenValidationByStandard(
    token: { address: TokenResult['address']; networkId: TokenResult['networkId'] },
    accountId: AccountId
  ) {
    if (this.validTokens.erc20[`${token.address}-${token.networkId}`] === true) return

    const [isValid, standard]: [boolean, string] = (await validateERC20Token(
      token,
      accountId,
      this.#settings.providers[token.networkId]
    )) as [boolean, string]

    this.validTokens[standard] = {
      ...this.validTokens[standard],
      [`${token.address}-${token.networkId}`]: isValid
    }

    this.emitUpdate()
  }

  initializePortfolioLibIfNeeded(
    accountId: AccountId,
    networkId: NetworkId,
    network: NetworkDescriptor
  ) {
    const providers = this.#settings.providers
    const key = `${networkId}:${accountId}`
    // Initialize a new Portfolio lib if:
    // 1. It does not exist in the portfolioLibs map
    // 2. The network RPC URL has changed
    if (
      !this.#portfolioLibs.has(key) ||
      this.#portfolioLibs.get(key)?.network?.selectedRpcUrl !==
        // eslint-disable-next-line no-underscore-dangle
        providers[network.id]?._getConnection().url
    ) {
      this.#portfolioLibs.set(key, new Portfolio(fetch, providers[network.id], network))
    }
    return this.#portfolioLibs.get(key)!
  }

  async getTemporaryTokens(accountId: AccountId, networkId: NetworkId, additionalHint: string) {
    const network = this.#settings.networks.find((x) => x.id === networkId)

    if (!network) throw new Error('network not found')

    const portfolioLib = this.initializePortfolioLibIfNeeded(accountId, networkId, network)

    const temporaryTokensToFetch =
      (this.temporaryTokens[network.id] &&
        this.temporaryTokens[network.id].result?.tokens.filter(
          (x) => x.address !== additionalHint
        )) ||
      []

    this.temporaryTokens[network.id] = {
      isLoading: false,
      errors: [],
      result: this.temporaryTokens[network.id] && this.temporaryTokens[network.id].result
    }
    this.emitUpdate()

    try {
      const result = await portfolioLib.get(accountId, {
        priceRecency: 60000,
        additionalHints: [additionalHint, ...temporaryTokensToFetch.map((x) => x.address)],
        disableAutoDiscovery: true
      })
      this.temporaryTokens[network.id] = {
        isLoading: false,
        errors: [],
        result: {
          tokens: result.tokens
        }
      }
      this.emitUpdate()
      return true
    } catch (e: any) {
      this.emitError({
        level: 'silent',
        message: "Error while executing the 'get' function in the portfolio library.",
        error: e
      })
      this.temporaryTokens[network.id].isLoading = false
      this.temporaryTokens[network.id].errors.push(e)
      this.emitUpdate()
      return false
    }
  }

  async #getAdditionalPortfolio(accountId: AccountId) {
    const hasNonZeroTokens = !!this.#networksWithAssetsByAccounts?.[accountId]?.length

    const start = Date.now()
    const accountState = this.latest[accountId]

    this.#setNetworkLoading(accountId, 'gasTank', true)
    this.#setNetworkLoading(accountId, 'rewards', true)
    this.emitUpdate()

    let res: any
    try {
      res = await this.#callRelayer(`/v2/identity/${accountId}/portfolio-additional`)
    } catch (e: any) {
      console.error('relayer error for portfolio additional')
      this.#setNetworkLoading(accountId, 'gasTank', false, e)
      this.#setNetworkLoading(accountId, 'rewards', false, e)
      this.emitUpdate()
      return
    }

    if (!res) throw new Error('portfolio controller: no res, should never happen')

    const rewardsTokens = [
      res.data.rewards.xWalletClaimableBalance || [],
      res.data.rewards.walletClaimableBalance || []
    ]
      .flat()
      .map((t: any) => ({
        ...t,
        flags: getFlags(res.data.rewards, 'rewards', t.networkId, t.address)
      }))

    accountState.rewards = {
      isReady: true,
      isLoading: false,
      errors: [],
      result: {
        ...res.data.rewards,
        updateStarted: start,
        tokens: rewardsTokens,
        total: getTotal(rewardsTokens)
      }
    }

    const gasTankTokens = res.data.gasTank.balance.map((t: any) => ({
      ...t,
      flags: getFlags(res.data, 'gasTank', t.networkId, t.address)
    }))

    accountState.gasTank = {
      isReady: true,
      isLoading: false,
      errors: [],
      result: {
        updateStarted: start,
        tokens: [
          ...gasTankTokens,
          ...getPinnedGasTankTokens(
            res.data.gasTank.availableGasTankAssets,
            hasNonZeroTokens,
            accountId,
            gasTankTokens
          )
        ],
        total: getTotal(gasTankTokens)
      }
    }

    this.emitUpdate()
  }

  // NOTE: we always pass in all `accounts` and `networks` to ensure that the user of this
  // controller doesn't have to update this controller every time that those are updated

  // The recommended behavior of the application that this API encourages is:
  // 1) when the user selects an account, update it's portfolio on all networks (latest state only) by calling updateSelectedAccount
  // 2) every time the user has a change in their pending (to be signed or to be mined) bundle(s) on a
  // certain network, call updateSelectedAccount again with those bundles; it will update the portfolio balance
  // on each network where there are bundles, and it will update both `latest` and `pending` states on said networks
  // it will also use a high `priceRecency` to make sure we don't lose time in updating prices (since we care about running the simulations)

  // the purpose of this function is to call it when an account is selected or the queue of accountOps changes
  async updateSelectedAccount(
    accounts: Account[],
    networks: NetworkDescriptor[],
    accountId: AccountId,
    accountOps?: { [key: string]: AccountOp[] },
    opts?: {
      forceUpdate: boolean
    }
  ) {
    await this.#initialLoadPromise

    const hasNonZeroTokens = !!this.#networksWithAssetsByAccounts?.[accountId]?.length
    // Load storage cached hints
    const storagePreviousHints = this.#previousHints

    const selectedAccount = accounts.find((x) => x.addr === accountId)
    if (!selectedAccount) throw new Error('selected account does not exist')

    this.#prepareLatestState(selectedAccount, networks)
    this.#preparePendingState(selectedAccount.addr, networks)

    const accountState = this.latest[accountId]
    const pendingState = this.pending[accountId]

    if (shouldGetAdditionalPortfolio(selectedAccount)) {
      this.#getAdditionalPortfolio(accountId)
    }

    const updatePortfolioState = async (
      _accountState: AccountState,
      network: NetworkDescriptor,
      portfolioLib: Portfolio,
      portfolioProps: Partial<GetOptions>,
      forceUpdate: boolean
    ): Promise<boolean> => {
      if (!_accountState[network.id]) {
        _accountState[network.id] = { isReady: false, isLoading: false, errors: [] }
        this.emitUpdate()
      }
      const state = _accountState[network.id]!

      // When the portfolio was called lastly
      const lastUpdateStartedAt = state.result?.updateStarted
      if (
        lastUpdateStartedAt &&
        Date.now() - lastUpdateStartedAt <= this.#minUpdateInterval &&
        !forceUpdate
      )
        return false

      // Only one loading at a time, ensure there are no race conditions
      if (state.isLoading && !forceUpdate) return false

      state.isLoading = true
      this.emitUpdate()

      const tokenPreferences = this.tokenPreferences

      try {
        const result = await portfolioLib.get(accountId, {
          priceRecency: 60000,
          priceCache: state.result?.priceCache,
          fetchPinned: !hasNonZeroTokens,
          tokenPreferences,
          ...portfolioProps
        })

        const additionalHints = portfolioProps.additionalHints || []

        _accountState[network.id] = {
          isReady: true,
          isLoading: false,
          errors: result.errors,
          result: {
            ...result,
            tokens: result.tokens.filter((token) =>
              tokenFilter(token, network, hasNonZeroTokens, additionalHints, tokenPreferences)
            ),
            total: getTotal(result.tokens)
          }
        }
        this.emitUpdate()
        return true
      } catch (e: any) {
        this.emitError({
          level: 'silent',
          message: "Error while executing the 'get' function in the portfolio library.",
          error: e
        })
        state.isLoading = false
        if (!state.isReady) state.criticalError = e
        else state.errors.push(e)
        this.emitUpdate()
        return false
      }
    }

    await Promise.all(
      networks.map(async (network) => {
        const key = `${network.id}:${accountId}`

        const portfolioLib = this.initializePortfolioLibIfNeeded(accountId, network.id, network)

        const currentAccountOps = accountOps?.[network.id]
        const simulatedAccountOps = pendingState[network.id]?.accountOps

        // We are performing the following extended check because both (or one of both) variables may have an undefined value.
        // If both variables contain AccountOps, we can simply compare for changes in the AccountOps intent.
        // However, when one of the variables is not set, two cases arise:
        // 1. A change occurs if one variable is undefined and the other one holds an AccountOps object.
        // 2. No change occurs if both variables are undefined.
        const areAccountOpsChanged =
          // eslint-disable-next-line prettier/prettier
          currentAccountOps && simulatedAccountOps
            ? !isAccountOpsIntentEqual(currentAccountOps, simulatedAccountOps)
            : currentAccountOps !== simulatedAccountOps

        const forceUpdate = opts?.forceUpdate || areAccountOpsChanged

        // Pass in learnedTokens as additionalHints only on areAccountOpsChanged
        const fallbackHints = (storagePreviousHints?.fromExternalAPI &&
          storagePreviousHints?.fromExternalAPI[key]) ?? {
          erc20s: [],
          erc721s: {}
        }
        const additionalHints =
          (forceUpdate &&
            Object.keys(
              (storagePreviousHints?.learnedTokens &&
                storagePreviousHints?.learnedTokens[network.id]) ??
                {}
            )) ||
          []

        const [isSuccessfulLatestUpdate] = await Promise.all([
          // Latest state update
          updatePortfolioState(
            accountState,
            network,
            portfolioLib,
            {
              blockTag: 'latest',
              previousHints: fallbackHints,
              additionalHints
            },
            forceUpdate
          ),
          // Pending state update
          // We are updating the pending state, only if AccountOps are changed or the application logic requests a force update
          forceUpdate
            ? await updatePortfolioState(
                pendingState,
                network,
                portfolioLib,
                {
                  blockTag: 'pending',
                  previousHints: fallbackHints,
                  ...(currentAccountOps && {
                    simulation: {
                      account: selectedAccount,
                      accountOps: currentAccountOps
                    }
                  }),
                  isEOA: !isSmartAccount(selectedAccount),
                  additionalHints
                },
                forceUpdate
              )
            : Promise.resolve(false)
        ])

        // Persist latest state in previousHints in the disk storage for further requests
        if (
          isSuccessfulLatestUpdate &&
          !areAccountOpsChanged &&
          accountState[network.id]?.result?.hintsFromExternalAPI
        ) {
          const updatedStoragePreviousHints = getUpdatedHints(
            accountState[network.id]!.result!.hintsFromExternalAPI as ExternalHintsAPIResponse,
            accountState[network.id]!.result!.tokens,
            network.id,
            storagePreviousHints,
            key,
            this.tokenPreferences
          )

          this.#previousHints = updatedStoragePreviousHints

          await this.#storage.set('previousHints', updatedStoragePreviousHints)
        }

        // We cache the previously simulated AccountOps
        // in order to compare them with the newly passed AccountOps before executing a new updatePortfolioState.
        // This allows us to identify any differences between the two.
        // TODO: If we enable the below line, pending states stopped working in the application (extension).
        //  In the case we run this logic under a testing environment, then it works as expected.
        //  As it is not a deal-breaker (for now), we will comment it out and will fix it later this week.
        // if (isSuccessfulPendingUpdate && currentAccountOps) {
        //   pendingState[network.id]!.accountOps = currentAccountOps
        // }
      })
    )

    await this.#updateNetworksWithAssets(accounts, accountId, accountState)

    this.emitUpdate()
  }

  // Learn new tokens from humanizer and debug_traceCall
  async learnTokens(tokenAddresses: string[] | undefined, networkId: NetworkId) {
    if (!tokenAddresses) return

    const storagePreviousHints = this.#previousHints

    if (!storagePreviousHints.learnedTokens) storagePreviousHints.learnedTokens = {}

    const { learnedTokens } = storagePreviousHints
    let networkLearnedTokens: { [key: string]: string | null } = learnedTokens[networkId] || {}

    const tokensToLearn = tokenAddresses.reduce((acc: { [key: string]: null }, address) => {
      if (address === ZeroAddress) return acc

      // Keep the timestamp of all learned tokens
      acc[address] = acc[address] || null
      return acc
    }, {})

    if (!Object.keys(tokensToLearn).length) return
    // Add new tokens in the beginning of the list
    networkLearnedTokens = { ...tokensToLearn, ...networkLearnedTokens }

    // Reached limit
    if (LEARNED_TOKENS_NETWORK_LIMIT - Object.keys(networkLearnedTokens).length < 0) {
      const learnedTokensArray = Object.entries(networkLearnedTokens).sort(
        (a, b) => Number(a[1]) - Number(b[1])
      )

      networkLearnedTokens = Object.fromEntries(
        learnedTokensArray.slice(0, LEARNED_TOKENS_NETWORK_LIMIT)
      )
    }

    const updatedPreviousHintsStorage = { ...storagePreviousHints }
    updatedPreviousHintsStorage.learnedTokens[networkId] = networkLearnedTokens

    this.#previousHints = updatedPreviousHintsStorage
    await this.#storage.set('previousHints', updatedPreviousHintsStorage)
  }

  get networksWithAssets() {
    return [...new Set(Object.values(this.#networksWithAssetsByAccounts).flat())]
  }

  get banners() {
    const networks = this.#settings.networks
    const providers = this.#settings.providers

    const networksWithFailedRPCBanners = getNetworksWithFailedRPCBanners({
      providers,
      networks,
      networksWithAssets: this.networksWithAssets
    })
    const networksWithPortfolioErrorBanners = getNetworksWithPortfolioErrorBanners({
      networks,
      portfolioLatest: this.latest
    })

    return [...networksWithFailedRPCBanners, ...networksWithPortfolioErrorBanners]
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      networksWithAssets: this.networksWithAssets,
      banners: this.banners
    }
  }
}
