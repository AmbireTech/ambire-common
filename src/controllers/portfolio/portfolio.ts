/* eslint-disable no-restricted-syntax */
import { getAddress, ZeroAddress } from 'ethers'

import { STK_WALLET } from '../../consts/addresses'
import {
  Account,
  AccountId,
  AccountOnchainState,
  IAccountsController
} from '../../interfaces/account'
import { Banner, IBannerController } from '../../interfaces/banner'
import { Fetch } from '../../interfaces/fetch'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController, Network } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { isBasicAccount } from '../../libs/account/account'
/* eslint-disable @typescript-eslint/no-shadow */
import { AccountOp, isAccountOpsIntentEqual } from '../../libs/accountOp/accountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { Portfolio } from '../../libs/portfolio'
import batcher from '../../libs/portfolio/batcher'
/* eslint-disable @typescript-eslint/no-use-before-define */
import { CustomToken, TokenPreference } from '../../libs/portfolio/customToken'
import getAccountNetworksWithAssets from '../../libs/portfolio/getNetworksWithAssets'
import {
  erc721CollectionToLearnedAssetKeys,
  getFlags,
  getSpecialHints,
  getTotal,
  learnedErc721sToHints,
  validateERC20Token
} from '../../libs/portfolio/helpers'
import {
  AccountAssetsState,
  AccountState,
  GasTankTokenResult,
  GetOptions,
  LearnedAssets,
  NetworkState,
  PortfolioControllerState,
  PreviousHintsStorage,
  TemporaryTokens,
  ToBeLearnedAssets,
  TokenResult
} from '../../libs/portfolio/interfaces'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { yieldToMain } from '../../utils/scheduler'
import EventEmitter from '../eventEmitter/eventEmitter'

/* eslint-disable @typescript-eslint/no-shadow */

const LEARNED_UNOWNED_LIMITS = {
  erc20s: 20,
  erc721s: 20
}
const EXTERNAL_API_HINTS_TTL = {
  dynamic: 15 * 60 * 1000,
  static: 60 * 60 * 1000
}

export class PortfolioController extends EventEmitter implements IPortfolioController {
  #latest: PortfolioControllerState

  #pending: PortfolioControllerState

  // A queue to prevent race conditions when calling `updateSelectedAccount`.
  // All calls are queued by network and account.
  // Each time `updateSelectedAccount` is invoked to update the latest or pending state, the call is added to the queue.
  // If a previous call is still running, the new call will be queued and executed only after the first one completes,
  // regardless of whether it succeeds or fails.
  // Before implementing this queue, multiple `updateSelectedAccount` calls made in a short period of time could cause
  // the response of the latest call to be overwritten by a slower previous call.
  #queue: { [accountId: string]: { [chainId: string]: Promise<void> } }

  customTokens: CustomToken[] = []

  tokenPreferences: TokenPreference[] = []

  validTokens: any = { erc20: {}, erc721: {} }

  temporaryTokens: TemporaryTokens = {}

  #portfolioLibs: Map<string, Portfolio>

  #banner: IBannerController

  #storage: IStorageController

  #fetch: Fetch

  #callRelayer: Function

  #velcroUrl: string

  #batchedVelcroDiscovery: Function

  #networksWithAssetsByAccounts: {
    [accountId: string]: AccountAssetsState
  } = {}

  /**
   * @deprecated - see #learnedAssets
   */
  #previousHints: PreviousHintsStorage = {
    fromExternalAPI: {},
    learnedTokens: {},
    learnedNfts: {}
  }

  /**
   * TODO: Figure out a way to clean/reset this structure
   */
  #toBeLearnedAssets: ToBeLearnedAssets = {
    erc20s: {},
    erc721s: {}
  }

  #learnedAssets: LearnedAssets = { erc20s: {}, erc721s: {} }

  #providers: IProvidersController

  #networks: INetworksController

  #accounts: IAccountsController

  #keystore: IKeystoreController

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise?: Promise<void>

  constructor(
    storage: IStorageController,
    fetch: Fetch,
    providers: IProvidersController,
    networks: INetworksController,
    accounts: IAccountsController,
    keystore: IKeystoreController,
    relayerUrl: string,
    velcroUrl: string,
    banner: IBannerController
  ) {
    super()
    this.#latest = {}
    this.#pending = {}
    this.#queue = {}
    this.#portfolioLibs = new Map()
    this.#storage = storage
    this.#fetch = fetch
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.#velcroUrl = velcroUrl
    this.#providers = providers
    this.#networks = networks
    this.#accounts = accounts
    this.#keystore = keystore
    this.temporaryTokens = {}
    this.#banner = banner
    this.#batchedVelcroDiscovery = batcher(
      fetch,
      (queue) => {
        const baseCurrencies = [...new Set(queue.map((x) => x.data.baseCurrency))]
        const accountAddrs = [...new Set(queue.map((x) => x.data.accountAddr))]
        const pairs = baseCurrencies
          .map((baseCurrency) => accountAddrs.map((accountAddr) => ({ baseCurrency, accountAddr })))
          .flat()
        return pairs.map(({ baseCurrency, accountAddr }) => {
          const queueSegment = queue.filter(
            (x) => x.data.baseCurrency === baseCurrency && x.data.accountAddr === accountAddr
          )
          const url = `${velcroUrl}/multi-hints?networks=${queueSegment
            .map((x) => x.data.chainId)
            .join(',')}&accounts=${queueSegment
            .map((x) => x.data.accountAddr)
            .join(',')}&baseCurrency=${baseCurrency}`

          return { url, queueSegment }
        })
      },
      {
        timeoutSettings: {
          timeoutAfter: 3000,
          timeoutErrorMessage: 'Velcro discovery timed out'
        },
        dedupeByKeys: ['chainId', 'accountAddr']
      }
    )

    this.#initialLoadPromise = this.#load().finally(() => {
      this.#initialLoadPromise = undefined
    })
  }

  async #load() {
    try {
      await this.#networks.initialLoadPromise
      await this.#accounts.initialLoadPromise

      this.tokenPreferences = await this.#storage.get('tokenPreferences', [])
      this.customTokens = await this.#storage.get('customTokens', [])

      this.#learnedAssets = await this.#storage.get('learnedAssets', this.#learnedAssets)
      this.#previousHints = await this.#storage.get('previousHints', {})
      // Don't load fromExternalAPI hints in memory as they are no longer used
      this.#previousHints.fromExternalAPI = {}
      const networksWithAssets = await this.#storage.get('networksWithAssetsByAccount', {})
      const isOldStructure = Object.keys(networksWithAssets).every(
        (key) =>
          Array.isArray(networksWithAssets[key]) &&
          (networksWithAssets[key] as any).every((item: any) => typeof item === 'string')
      )
      if (!isOldStructure) {
        this.#networksWithAssetsByAccounts = networksWithAssets
      }
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

  async #updatePortfolioOnTokenChange(chainId: bigint, selectedAccountAddr?: string) {
    // As this function currently only updates the portfolio we can skip it altogether
    // if skipPortfolioUpdate is set to true
    if (!selectedAccountAddr) return

    const networkData = this.#networks.networks.find((n) => n.chainId === chainId)
    await this.updateSelectedAccount(selectedAccountAddr, networkData ? [networkData] : undefined)
  }

  async addCustomToken(
    customToken: CustomToken,
    selectedAccountAddr?: string,
    shouldUpdatePortfolio?: boolean
  ) {
    await this.#initialLoadPromise
    const isTokenAlreadyAdded = this.customTokens.some(
      ({ address, chainId }) =>
        address.toLowerCase() === customToken.address.toLowerCase() &&
        chainId === customToken.chainId
    )

    if (isTokenAlreadyAdded) return

    this.customTokens.push(customToken)

    if (shouldUpdatePortfolio) {
      await this.#updatePortfolioOnTokenChange(customToken.chainId, selectedAccountAddr)
    }

    await this.#storage.set('customTokens', this.customTokens)
  }

  async removeCustomToken(
    customToken: Omit<CustomToken, 'standard'>,
    selectedAccountAddr?: string,
    shouldUpdatePortfolio?: boolean
  ) {
    await this.#initialLoadPromise
    this.customTokens = this.customTokens.filter(
      (token) =>
        !(
          token.address.toLowerCase() === customToken.address.toLowerCase() &&
          token.chainId === customToken.chainId
        )
    )
    const existingPreference = this.tokenPreferences.some(
      (pref) => pref.address === customToken.address && pref.chainId === customToken.chainId
    )

    // Delete custom token preference if it exists
    if (existingPreference) {
      await this.toggleHideToken(customToken, selectedAccountAddr, shouldUpdatePortfolio)
      await this.#storage.set('customTokens', this.customTokens)
    } else {
      this.emitUpdate()
      if (shouldUpdatePortfolio) {
        await this.#updatePortfolioOnTokenChange(customToken.chainId, selectedAccountAddr)
      }
      await this.#storage.set('customTokens', this.customTokens)
    }
  }

  async toggleHideToken(
    tokenPreference: TokenPreference,
    selectedAccountAddr?: string,
    shouldUpdatePortfolio?: boolean
  ) {
    await this.#initialLoadPromise

    const existingPreference = this.tokenPreferences.find(
      ({ address, chainId }) =>
        address.toLowerCase() === tokenPreference.address.toLowerCase() &&
        chainId === tokenPreference.chainId
    )

    // Push the token as hidden
    if (!existingPreference) {
      this.tokenPreferences.push({ ...tokenPreference, isHidden: true })
      // Remove the token preference if the user decides to show it again
    } else if (existingPreference.isHidden) {
      this.tokenPreferences = this.tokenPreferences.filter(
        ({ address, chainId }) =>
          !(address === tokenPreference.address && chainId === tokenPreference.chainId)
      )
    } else {
      // Should happen only after migration
      existingPreference.isHidden = !existingPreference.isHidden
    }

    this.emitUpdate()
    if (shouldUpdatePortfolio) {
      await this.#updatePortfolioOnTokenChange(tokenPreference.chainId, selectedAccountAddr)
    }
    await this.#storage.set('tokenPreferences', this.tokenPreferences)
  }

  async #updateNetworksWithAssets(accountId: AccountId, accountState: AccountState) {
    const storageStateByAccount = this.#networksWithAssetsByAccounts

    this.#networksWithAssetsByAccounts[accountId] = getAccountNetworksWithAssets(
      accountId,
      accountState,
      storageStateByAccount,
      this.#providers.providers
    )

    this.emitUpdate()
    await this.#storage.set('networksWithAssetsByAccount', this.#networksWithAssetsByAccounts)
  }

  #setNetworkLoading(
    accountId: AccountId,
    stateKey: 'latest' | 'pending',
    network: string,
    isLoading: boolean,
    error?: any
  ) {
    const states = { latest: this.#latest, pending: this.#pending }
    const accountState = states[stateKey][accountId]
    if (!accountState[network]) accountState[network] = { errors: [], isReady: false, isLoading }
    accountState[network]!.isLoading = isLoading
    if (error)
      accountState[network]!.criticalError = {
        message:
          error?.message || 'Error while executing the get function in the portfolio library.',
        simulationErrorMsg: error?.simulationErrorMsg,
        stack: error?.stack,
        name: error?.name
      }
  }

  removeNetworkData(chainId: bigint) {
    for (const accountState of [this.#latest, this.#pending]) {
      for (const accountId of Object.keys(accountState)) {
        delete accountState[accountId][chainId.toString()]
      }
    }
    this.emitUpdate()
  }

  // make the pending results the same as the latest ones
  overridePendingResults(accountOp: AccountOp) {
    if (
      this.#pending[accountOp.accountAddr] &&
      this.#pending[accountOp.accountAddr][accountOp.chainId.toString()] &&
      this.#latest[accountOp.accountAddr] &&
      this.#latest[accountOp.accountAddr][accountOp.chainId.toString()]
    ) {
      this.#pending[accountOp.accountAddr][accountOp.chainId.toString()]!.result =
        this.#latest[accountOp.accountAddr][accountOp.chainId.toString()]!.result
      this.emitUpdate()
    }
  }

  async updateTokenValidationByStandard(
    token: { address: TokenResult['address']; chainId: TokenResult['chainId'] },
    accountId: AccountId
  ) {
    await this.#initialLoadPromise
    if (this.validTokens.erc20[`${token.address}-${token.chainId}`] === true) return

    const [isValid, standard]: [boolean, string] = (await validateERC20Token(
      token,
      accountId,
      this.#providers.providers[token.chainId.toString()]
    )) as [boolean, string]

    this.validTokens[standard] = {
      ...this.validTokens[standard],
      [`${token.address}-${token.chainId}`]: isValid
    }

    this.emitUpdate()
  }

  initializePortfolioLibIfNeeded(
    accountId: AccountId,
    chainId: bigint,
    network: Network
  ): Portfolio | null {
    const providers = this.#providers.providers
    const key = `${chainId}:${accountId}`
    // Initialize a new Portfolio lib if:
    // 1. It does not exist in the portfolioLibs map
    // 2. The network RPC URL has changed
    if (
      !this.#portfolioLibs.has(key) ||
      this.#portfolioLibs.get(key)?.network?.selectedRpcUrl !==
        // eslint-disable-next-line no-underscore-dangle
        providers[network.chainId.toString()]?._getConnection().url
    ) {
      try {
        this.#portfolioLibs.set(
          key,
          new Portfolio(
            this.#fetch,
            providers[network.chainId.toString()],
            network,
            this.#velcroUrl,
            this.#batchedVelcroDiscovery
          )
        )
      } catch (e: any) {
        return null
      }
    }
    return this.#portfolioLibs.get(key)!
  }

  async getTemporaryTokens(accountId: AccountId, chainId: bigint, additionalHint: string) {
    const network = this.#networks.networks.find((x) => x.chainId === chainId)

    if (!network) throw new Error(`Network with chainId ${chainId} not found`)

    const portfolioLib = this.initializePortfolioLibIfNeeded(accountId, chainId, network)

    const temporaryTokensToFetch =
      (this.temporaryTokens[network.chainId.toString()] &&
        this.temporaryTokens[network.chainId.toString()].result?.tokens.filter(
          (x) => x.address !== additionalHint
        )) ||
      []

    this.temporaryTokens[network.chainId.toString()] = {
      isLoading: false,
      errors: [],
      result:
        this.temporaryTokens[network.chainId.toString()] &&
        this.temporaryTokens[network.chainId.toString()].result
    }
    this.emitUpdate()

    try {
      if (!portfolioLib) {
        throw new Error(
          `a portfolio library is not initialized for ${network.name} (${network.chainId})`
        )
      }

      const result = await portfolioLib.get(accountId, {
        priceRecency: 60000 * 5,
        additionalErc20Hints: [additionalHint, ...temporaryTokensToFetch.map((x) => x.address)],
        disableAutoDiscovery: true
      })
      this.temporaryTokens[network.chainId.toString()] = {
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
        message: `Error while executing the 'get' function in the portfolio library on ${network.name} (${network.chainId}).`,
        error: e
      })
      this.temporaryTokens[network.chainId.toString()].isLoading = false
      this.temporaryTokens[network.chainId.toString()].errors.push(e)
      this.emitUpdate()
      return false
    }
  }

  async #getAdditionalPortfolio(accountId: AccountId, maxDataAgeMs?: number) {
    const rewardsOrGasTankState =
      this.#latest[accountId]?.rewards || this.#latest[accountId]?.gasTank
    const canSkipUpdate = rewardsOrGasTankState
      ? PortfolioController.#getCanSkipUpdate(rewardsOrGasTankState, maxDataAgeMs)
      : false

    if (canSkipUpdate) return

    const start = Date.now()
    const accountState = this.#latest[accountId]

    this.#setNetworkLoading(accountId, 'latest', 'gasTank', true)
    this.#setNetworkLoading(accountId, 'latest', 'rewards', true)
    this.emitUpdate()

    let res: any
    try {
      res = await this.#callRelayer(`/v2/identity/${accountId}/portfolio-additional`)
    } catch (e: any) {
      console.error('relayer error for portfolio additional')
      this.#setNetworkLoading(accountId, 'latest', 'gasTank', false, e)
      this.#setNetworkLoading(accountId, 'latest', 'rewards', false, e)
      this.emitUpdate()
      return
    }

    if (res.data.banner) {
      const banner = res.data.banner

      const formattedBanner: Banner = {
        // eslint-disable-next-line no-underscore-dangle
        id: banner.id || banner._id,
        type: banner.type || 'updates',
        params: {
          startTime: banner.startTime,
          endTime: banner.endTime
        },
        ...(banner.text && { text: banner.text }),
        ...(banner.title && { title: banner.title }),
        ...(banner.url && {
          actions: [
            {
              label: 'Open',
              actionName: 'open-link',
              meta: { url: banner.url }
            }
          ]
        })
      }

      this.#banner.addBanner(formattedBanner)
    }

    if (!res) throw new Error('portfolio controller: no res, should never happen')

    const rewardsTokens = [
      res.data.rewards.stkWalletClaimableBalance || [],
      res.data.rewards.walletClaimableBalance || []
    ]
      .flat()
      .map((t: any) => ({
        ...t,
        chainId: BigInt(t.chainId || 1),
        amount: BigInt(t.amount || 0),
        symbol: t.address === STK_WALLET ? 'stkWALLET' : t.symbol,
        flags: getFlags(res.data.rewards, 'rewards', t.chainId, t.address)
      }))

    accountState.rewards = {
      isReady: true,
      isLoading: false,
      errors: [],
      result: {
        ...res.data.rewards,
        lastSuccessfulUpdate: Date.now(),
        updateStarted: start,
        tokens: rewardsTokens,
        total: getTotal(rewardsTokens)
      }
    }

    const gasTankTokens: GasTankTokenResult[] = res.data.gasTank.balance.map((t: any) => ({
      ...t,
      amount: BigInt(t.amount || 0),
      chainId: BigInt(t.chainId || 1),
      availableAmount: BigInt(t.availableAmount || 0),
      cashback: BigInt(t.cashback || 0),
      saved: BigInt(t.saved || 0),
      flags: getFlags(res.data, 'gasTank', t.chainId, t.address)
    }))

    accountState.gasTank = {
      isReady: true,
      isLoading: false,
      errors: [],
      result: {
        updateStarted: start,
        lastSuccessfulUpdate: Date.now(),
        tokens: [],
        gasTankTokens,
        total: getTotal(gasTankTokens)
      }
    }

    this.emitUpdate()
  }

  static #getCanSkipUpdate(networkState?: NetworkState, maxDataAgeMs?: number) {
    const hasImportantErrors = networkState?.errors.some((e) => e.level === 'critical')

    if (!maxDataAgeMs || !networkState || networkState.criticalError || hasImportantErrors)
      return false
    const updateStarted = networkState.result?.updateStarted || 0
    const isWithinMinUpdateInterval = !!updateStarted && Date.now() - updateStarted < maxDataAgeMs

    return isWithinMinUpdateInterval || networkState.isLoading
  }

  // By our convention, we always stick with private (#) instead of protected methods.
  // However, we made a compromise here to allow Jest tests to mock updatePortfolioState.
  protected async updatePortfolioState(
    accountId: string,
    network: Network,
    portfolioLib: Portfolio | null,
    portfolioProps: Partial<GetOptions> & {
      blockTag: 'latest' | 'pending'
      maxDataAgeMs?: number
      isManualUpdate?: boolean
    }
  ): Promise<boolean> {
    const { blockTag, maxDataAgeMs, isManualUpdate } = portfolioProps
    const stateKeys = { latest: this.#latest, pending: this.#pending }
    const accountState = stateKeys[blockTag][accountId]

    // Can occur if the account is removed while updateSelectedAccount is in progress
    if (!accountState) return false

    if (!accountState[network.chainId.toString()]) {
      // isLoading must be false here, otherwise canSkipUpdate will return true
      // and portfolio will not be updated
      accountState[network.chainId.toString()] = { isLoading: false, isReady: false, errors: [] }
    }

    const canSkipUpdate = PortfolioController.#getCanSkipUpdate(
      accountState[network.chainId.toString()],
      maxDataAgeMs
    )

    if (canSkipUpdate) return false

    this.#setNetworkLoading(accountId, blockTag, network.chainId.toString(), true)
    const state = accountState[network.chainId.toString()]!
    if (isManualUpdate) state.criticalError = undefined

    this.emitUpdate()

    const hasNonZeroTokens = !!Object.values(
      this.#networksWithAssetsByAccounts?.[accountId] || {}
    ).some(Boolean)

    try {
      if (!portfolioLib)
        throw new Error(
          `a portfolio library is not initialized for ${network.name} (${network.chainId})`
        )

      const result = await portfolioLib.get(accountId, {
        priceRecency: 60000 * 5,
        priceCache: state.result?.priceCache,
        fetchPinned: !hasNonZeroTokens,
        ...portfolioProps
      })

      const hasError = result.errors.some((e) => e.level !== 'silent')
      let lastSuccessfulUpdate =
        accountState[network.chainId.toString()]?.result?.lastSuccessfulUpdate || 0

      // Reset lastSuccessfulUpdate on isManualUpdate in case of critical errors as the user
      // is likely expecting a change in the portfolio.
      if (isManualUpdate && hasError) {
        lastSuccessfulUpdate = 0
      } else if (!hasError) {
        // Update the last successful update only if there are no critical errors.
        lastSuccessfulUpdate = Date.now()
      }

      accountState[network.chainId.toString()] = {
        // We cache the previously simulated AccountOps
        // in order to compare them with the newly passed AccountOps before executing a new updatePortfolioState.
        // This allows us to identify any differences between the two.
        accountOps: portfolioProps?.simulation?.accountOps,
        isReady: true,
        isLoading: false,
        errors: result.errors,
        result: {
          ...result,
          lastSuccessfulUpdate,
          tokens: result.tokens,
          total: getTotal(result.tokens)
        }
      }

      this.emitUpdate()
      return true
    } catch (e: any) {
      this.emitError({
        level: 'silent',
        message: `Error while executing the 'get' function in the portfolio library on ${network.name} (${network.chainId})`,
        error: e
      })
      state.isLoading = false
      // Convert the error to an object because the portfolio state is cloned
      // using structuredClone() which doesn't preserve custom error properties
      // like simulationErrorMsg
      state.criticalError = {
        message: e?.message || 'Error while executing the get function in the portfolio library.',
        simulationErrorMsg: e?.simulationErrorMsg,
        stack: e?.stack,
        name: e?.name
      }

      if (isManualUpdate && state.result) {
        // Reset lastSuccessfulUpdate on forceUpdate in case of a critical error as the user
        // is likely expecting a change in the portfolio.
        state.result.lastSuccessfulUpdate = 0
      }
      this.emitUpdate()

      return false
    }
  }

  /**
   * Gets hints from all sources and formats them as expected
   * by the portfolio lib. These are all hints the portfolio uses,
   * except the external hints discovery request
   */
  protected getAllHints(
    /**
     * Key - chainId:accountAddr
     */
    key: `${string}:${string}`,
    chainId: Network['chainId']
  ): Pick<
    Required<GetOptions>,
    'specialErc20Hints' | 'specialErc721Hints' | 'additionalErc20Hints' | 'additionalErc721Hints'
  > {
    const learnedTokens = this.#learnedAssets.erc20s[key]
    const learnedNfts = this.#learnedAssets.erc721s[key]
    const isKeyNotMigrated =
      typeof learnedTokens === 'undefined' || typeof learnedNfts === 'undefined'

    // Check if the user key exists in the new learned tokens structure
    // Fallback to the old structure if not
    const { specialErc20Hints, specialErc721Hints } = getSpecialHints(
      chainId,
      this.customTokens,
      this.tokenPreferences,
      this.#toBeLearnedAssets
    )

    // Add the tokens to toBeLearned, but only for this call if the key is not migrated.
    // After the portfolio update all tokens with balance > 0 will be learned.
    if (isKeyNotMigrated) {
      const oldStructureLearnedNfts = this.#previousHints.learnedNfts?.[chainId.toString()] || {}
      const oldStructureLearnedTokens =
        this.#previousHints.learnedTokens?.[chainId.toString()] || {}

      Object.keys(oldStructureLearnedTokens).forEach((tokenAddr) => {
        specialErc20Hints.learn.push(tokenAddr)
      })
      Object.keys(oldStructureLearnedNfts).forEach((collectionAddr) => {
        const nftIds = oldStructureLearnedNfts[collectionAddr]

        // A hint for the collection already exists
        if (specialErc721Hints.learn[collectionAddr]) {
          specialErc721Hints.learn[collectionAddr].push(...nftIds)
          return
        }

        specialErc721Hints.learn[collectionAddr] = nftIds
      })
    }

    return {
      specialErc20Hints,
      specialErc721Hints,
      // @TODO: Enrich learnedTokens and learnedNfts with data from other accounts
      // on manual updates. The user may have the token he is looking for in another account.
      // It's VERY important to do this only for imported accounts (not view-only), as hints
      // are now stored in storage, so learned will contain a lot of assets (performance hit).
      additionalErc20Hints: Object.keys(learnedTokens || {}),
      additionalErc721Hints: learnedErc721sToHints(Object.keys(learnedNfts || {}))
    }
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
    accountId: AccountId,
    networks?: Network[],
    simulation?: {
      accountOps: { [key: string]: AccountOp[] }
      states: { [chainId: string]: AccountOnchainState }
    },
    opts?: { maxDataAgeMs?: number; isManualUpdate?: boolean }
  ) {
    const { maxDataAgeMs: paramsMaxDataAgeMs = 0, isManualUpdate } = opts || {}
    await this.#initialLoadPromise
    const selectedAccount = this.#accounts.accounts.find((x) => x.addr === accountId)
    if (!selectedAccount)
      throw new Error(
        `${accountId} is not found in accounts. Account count: ${this.#accounts.accounts.length}`
      )
    if (!this.#latest[accountId]) this.#latest[accountId] = {}
    if (!this.#pending[accountId]) this.#pending[accountId] = {}

    const accountState = this.#latest[accountId]
    const pendingState = this.#pending[accountId]

    const networksToUpdate = networks || this.#networks.networks
    await Promise.all([
      this.#getAdditionalPortfolio(accountId, paramsMaxDataAgeMs),
      ...networksToUpdate.map(async (network) => {
        const key = `${network.chainId}:${accountId}` as `${string}:${string}`

        const portfolioLib = this.initializePortfolioLibIfNeeded(
          accountId,
          network.chainId,
          network
        )

        const currentAccountOps = simulation?.accountOps[network.chainId.toString()]?.filter(
          (op) => op.accountAddr === accountId
        )
        const state = simulation?.states?.[network.chainId.toString()]
        const simulatedAccountOps = pendingState[network.chainId.toString()]?.accountOps

        if (!this.#queue?.[accountId]?.[network.chainId.toString()])
          this.#queue[accountId] = {
            ...this.#queue[accountId],
            [network.chainId.toString()]: Promise.resolve()
          }

        const updatePromise = async (): Promise<void> => {
          // We are performing the following extended check because both (or one of both) variables may have an undefined value.
          // If both variables contain AccountOps, we can simply compare for changes in the AccountOps intent.
          // However, when one of the variables is not set, two cases arise:
          // 1. A change occurs if one variable is undefined and the other one holds an AccountOps object.
          // 2. No change occurs if both variables are undefined.
          const areAccountOpsChanged =
            currentAccountOps && simulatedAccountOps
              ? !isAccountOpsIntentEqual(currentAccountOps, simulatedAccountOps)
              : currentAccountOps !== simulatedAccountOps
          // Even if maxDataAgeMs is set to a non-zero value, we want to force an update when the AccountOps change.
          // We pass undefined, because setting the value to 0 would imply a manual update by the user.
          const maxDataAgeMs = areAccountOpsChanged ? undefined : paramsMaxDataAgeMs

          const hintsResponse =
            this.#latest[accountId][network.chainId.toString()]?.result?.lastExternalApiUpdateData

          const canSkipExternalApiHintsUpdate =
            !!hintsResponse &&
            !isManualUpdate &&
            Date.now() - hintsResponse.lastUpdate <
              EXTERNAL_API_HINTS_TTL[!hintsResponse.hasHints ? 'static' : 'dynamic']

          const allHints = this.getAllHints(key, network.chainId)

          const [isSuccessfulLatestUpdate] = await Promise.all([
            // Latest state update
            this.updatePortfolioState(accountId, network, portfolioLib, {
              blockTag: 'latest',
              maxDataAgeMs,
              isManualUpdate,
              lastExternalApiUpdateData: hintsResponse,
              ...allHints,
              disableAutoDiscovery: canSkipExternalApiHintsUpdate
            }),
            this.updatePortfolioState(accountId, network, portfolioLib, {
              blockTag: 'pending',
              maxDataAgeMs,
              isManualUpdate,
              lastExternalApiUpdateData: hintsResponse,
              ...(currentAccountOps &&
                state && {
                  simulation: {
                    account: selectedAccount,
                    accountOps: currentAccountOps,
                    state
                  }
                }),
              disableAutoDiscovery: canSkipExternalApiHintsUpdate,
              ...allHints
            })
          ])

          // Learn tokens and nfts from the portfolio lib
          if (isSuccessfulLatestUpdate && accountState[network.chainId.toString()]?.result) {
            const networkResult = accountState[network.chainId.toString()]!.result
            const { erc20s, erc721s } = networkResult?.toBeLearned || {}
            let shouldUpdateLearnedInStorage = false

            if (erc20s?.length) {
              await this.learnTokens(erc20s, key, network.chainId)
            } else if (!this.#learnedAssets.erc20s[key]) {
              // Finalize the migration from #previousHints
              this.#learnedAssets.erc20s[key] = {}
              shouldUpdateLearnedInStorage = true
            }
            if (erc721s && Object.keys(erc721s).length) {
              await this.learnNfts(
                Object.entries(erc721s).map(([collectionAddr, ids]) => [collectionAddr, ids]),
                accountId,
                network.chainId
              )
            } else if (!this.#learnedAssets.erc721s[key]) {
              // Finalize the migration from #previousHints
              this.#learnedAssets.erc721s[key] = {}
              shouldUpdateLearnedInStorage = true
            }

            if (shouldUpdateLearnedInStorage) {
              await this.#storage.set('learnedAssets', this.#learnedAssets)
            }
          }
        }

        // Chain the new updatePromise to the current queue
        this.#queue[accountId][network.chainId.toString()] = this.#queue[accountId][
          network.chainId.toString()
        ]
          .then(updatePromise)
          .catch(() => updatePromise())

        // Ensure the method waits for the entire queue to resolve
        await this.#queue[accountId][network.chainId.toString()]
        await yieldToMain()
      })
    ])

    await this.#updateNetworksWithAssets(accountId, accountState)
    this.emitUpdate()
  }

  markSimulationAsBroadcasted(accountId: string, chainId: bigint) {
    const simulation = this.#pending[accountId][chainId.toString()]?.accountOps?.[0]

    if (!simulation) return

    simulation.status = AccountOpStatus.BroadcastedButNotConfirmed

    this.emitUpdate()
  }

  /**
   * Adds tokens to the hints of the portfolio with the intention of learning them.
   * The tokens are removed only if they are learned, which happens if their balance is
   * more than 0.
   */
  addTokensToBeLearned(tokenAddresses: string[], chainId: bigint): boolean {
    if (!tokenAddresses.length) return false
    const chainIdString = chainId.toString()

    if (!this.#toBeLearnedAssets.erc20s[chainIdString])
      this.#toBeLearnedAssets.erc20s[chainIdString] = []

    let networkToBeLearnedTokens = this.#toBeLearnedAssets.erc20s[chainIdString]

    const alreadyLearned = networkToBeLearnedTokens.map((addr) => getAddress(addr))

    const tokensToLearn = tokenAddresses.filter((address) => {
      if (address === ZeroAddress) return false

      let normalizedAddress: string | undefined

      try {
        normalizedAddress = getAddress(address)
      } catch (e) {
        console.error('Error while normalizing token address', e)
      }

      if (!normalizedAddress) return false

      // Don't add to be learned if the token is already a custom token or a token with a preference
      if (
        this.tokenPreferences.find(
          ({ chainId: cId, address: addr }) => cId === chainId && addr === normalizedAddress
        ) ||
        this.customTokens.find(
          ({ chainId: cId, address: addr }) => cId === chainId && addr === normalizedAddress
        )
      )
        return false

      return !alreadyLearned.includes(normalizedAddress)
    })

    if (!tokensToLearn.length) return false

    networkToBeLearnedTokens = [...tokensToLearn, ...networkToBeLearnedTokens]

    this.#toBeLearnedAssets.erc20s[chainIdString] = networkToBeLearnedTokens
    return true
  }

  /**
   * Adds ERC-721 NFTs to the hints of the portfolio with the intention of learning them.
   * The nfts are removed only if they are learned, which happens if the user owns them
   */
  async addErc721sToBeLearned(
    nftsData: [string, bigint[]][] | undefined,
    accountAddr: string,
    chainId: bigint
  ): Promise<boolean> {
    try {
      if (!nftsData || !nftsData.length) return false

      const formattedNftsData: [string, bigint[]][] = []

      nftsData.forEach(([address, ids]) => {
        try {
          const checksummed = getAddress(address)

          formattedNftsData.push([checksummed, ids])
        } catch (e: any) {
          console.error('addErc721sToBeLearned: Error while normalizing nft address', e)
        }
      })

      if (!formattedNftsData.length) return false

      const key = `${chainId}:${accountAddr}`

      if (!this.#learnedAssets.erc721s[key]) {
        this.#learnedAssets.erc721s[key] = {}
      }

      if (!this.#toBeLearnedAssets.erc721s[chainId.toString()]) {
        this.#toBeLearnedAssets.erc721s[chainId.toString()] = {}
      }

      const toBeLearnedAssets = this.#toBeLearnedAssets.erc721s[chainId.toString()]
      const learnedErc721s = this.#learnedAssets.erc721s[key]

      let added = false

      formattedNftsData.forEach(([collectionAddress, tokenIds]) => {
        // An enumerable NFT of this type already exists in either toBeLearned or learnedAssets
        // so we don't have to add it again
        if (
          (toBeLearnedAssets[collectionAddress] && !toBeLearnedAssets[collectionAddress].length) ||
          (learnedErc721s && learnedErc721s[`${collectionAddress}:enumerable`])
        )
          return

        // Add an enumerable NFT toToBeLearned
        if (!tokenIds.length) {
          toBeLearnedAssets[collectionAddress] = []

          return
        }

        const ids = erc721CollectionToLearnedAssetKeys([collectionAddress, tokenIds])

        ids.forEach((id) => {
          const [, tokenIdString] = id.split(':')

          const tokenId = BigInt(tokenIdString)
          // An NFT with this id is already added to toBeLearned or learnedAssets
          if (
            learnedErc721s[id] ||
            (tokenId &&
              toBeLearnedAssets[collectionAddress] &&
              toBeLearnedAssets[collectionAddress].includes(BigInt(tokenId)))
          )
            return

          if (!added) {
            added = true
          }

          if (!toBeLearnedAssets[collectionAddress]) {
            toBeLearnedAssets[collectionAddress] = []
          }

          if (tokenId) toBeLearnedAssets[collectionAddress].push(tokenId)
        })
      })

      return added
    } catch (e: any) {
      console.error('Error during addErc721sToBeLearned: ', e)

      return false
    }
  }

  /**
   * Used to learn new tokens (by adding them to `learnedAssets`) and updating
   * the timestamps of learned tokens.
   *
   * !!NOTE: This method must be called only by updateSelectedAccount with tokens
   * that have a `balance > 0`, because it updates the timestamp of tokens, that indicates
   * when the token was last seen with a balance > 0
   */
  protected async learnTokens(
    tokensWithBalance: string[] | undefined,
    key: `${string}:${string}`,
    chainId: bigint
  ): Promise<boolean> {
    if (!tokensWithBalance) return false

    if (!this.#learnedAssets.erc20s[key]) this.#learnedAssets.erc20s[key] = {}

    const learnedTokens = this.#learnedAssets.erc20s[key]
    const now = Date.now()

    tokensWithBalance.forEach((address) => {
      if (address === ZeroAddress) return
      learnedTokens[address] = now

      if (this.#toBeLearnedAssets.erc20s[chainId.toString()]?.length) {
        // Remove the token from toBeLearnedTokens if it will be learned
        this.#toBeLearnedAssets.erc20s[chainId.toString()] = this.#toBeLearnedAssets.erc20s[
          chainId.toString()
        ].filter((addr) => addr !== address)
      }
    })

    // Keep a maximum of LEARNED_UNOWNED_LIMITS.erc20s tokens that are no longer owned by the user
    const noLongerOwnedTokens = Object.entries(learnedTokens)
      .filter(([, timestamp]) => timestamp !== now)
      // Sort by newest timestamp first
      .sort(([, timestampA], [, timestampB]) => timestampB - timestampA)
      .map(([address]) => address)

    // Remove the oldest no longer owned tokens
    if (noLongerOwnedTokens.length > LEARNED_UNOWNED_LIMITS.erc20s) {
      noLongerOwnedTokens.slice(LEARNED_UNOWNED_LIMITS.erc20s).forEach((address) => {
        delete learnedTokens[address]
      })
    }

    await this.#storage.set('learnedAssets', this.#learnedAssets)

    return true
  }

  /**
   * Used to learn new ERC-721 NFTs (by adding them to `learnedAssets`) and updating
   * the timestamps of learned collectibles.
   *
   * !!NOTE: This method must be called only by updateSelectedAccount with nfts
   * that the user owns, because it updates the timestamp of collectibles, that indicates
   * when the collectible was last seen with a balance > 0
   */
  protected async learnNfts(
    nftsData: [string, bigint[]][] | undefined,
    accountAddr: string,
    chainId: bigint
  ): Promise<boolean> {
    if (!nftsData?.length) return false
    const key = `${chainId.toString()}:${accountAddr}`

    if (!this.#learnedAssets.erc721s[key]) this.#learnedAssets.erc721s[key] = {}

    if (!nftsData.length) return false

    const now = Date.now()
    const learnedNfts: LearnedAssets['erc721s'][string] = this.#learnedAssets.erc721s[key]

    nftsData.forEach((collection) => {
      const ids = erc721CollectionToLearnedAssetKeys(collection)

      ids.forEach((id) => {
        learnedNfts[id] = now
      })
    })

    // Keep a maximum of LEARNED_UNOWNED_LIMITS.erc721s NFTs that are no longer owned by the user
    const noLongerOwnedNfts = Object.entries(learnedNfts)
      .filter(([, timestamp]) => {
        return timestamp !== now
      })
      .map(([id]) => id)

    // Remove the oldest no longer owned NFTs
    if (noLongerOwnedNfts.length > LEARNED_UNOWNED_LIMITS.erc721s) {
      noLongerOwnedNfts.slice(LEARNED_UNOWNED_LIMITS.erc721s).forEach((id) => {
        delete learnedNfts[id]
      })
    }

    await this.#storage.set('learnedAssets', this.#learnedAssets)

    return true
  }

  removeAccountData(address: Account['addr']) {
    delete this.#latest[address]
    delete this.#pending[address]
    delete this.#networksWithAssetsByAccounts[address]

    this.#networks.networks.forEach((network) => {
      const key = `${network.chainId}:${address}`

      if (key in this.#portfolioLibs) {
        this.#portfolioLibs.delete(key)
      }
    })
    this.#storage.set('previousHints', this.#previousHints)
    this.#storage.set('networksWithAssetsByAccount', this.#networksWithAssetsByAccounts)

    this.emitUpdate()
  }

  getLatestPortfolioState(accountAddr: string) {
    return this.#latest[accountAddr] || {}
  }

  getPendingPortfolioState(accountAddr: string) {
    return this.#pending[accountAddr] || {}
  }

  getNetworksWithAssets(accountAddr: string) {
    return this.#networksWithAssetsByAccounts[accountAddr] || []
  }

  async simulateAccountOp(op: AccountOp): Promise<void> {
    const account = this.#accounts.accounts.find((acc) => acc.addr === op.accountAddr)!
    const network = this.#networks.networks.find((net) => net.chainId === op.chainId)!
    const state = await this.#accounts.getOrFetchAccountOnChainState(op.accountAddr, op.chainId)
    const noSimulation = isBasicAccount(account, state) && network.rpcNoStateOverride
    const simulation = !noSimulation
      ? {
          accountOps: { [network.chainId.toString()]: [op] },
          states: await this.#accounts.getOrFetchAccountStates(op.accountAddr)
        }
      : undefined
    return this.updateSelectedAccount(op.accountAddr, [network], simulation)
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
