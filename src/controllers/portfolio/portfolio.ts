import { getAddress, ZeroAddress } from 'ethers'

import { Account, AccountId } from '../../interfaces/account'
import { Fetch } from '../../interfaces/fetch'
import { Network, NetworkId } from '../../interfaces/network'
/* eslint-disable @typescript-eslint/no-shadow */
import { Storage } from '../../interfaces/storage'
import { isSmartAccount } from '../../libs/account/account'
import { AccountOp, AccountOpStatus, isAccountOpsIntentEqual } from '../../libs/accountOp/accountOp'
import { Portfolio } from '../../libs/portfolio'
/* eslint-disable @typescript-eslint/no-use-before-define */
import { CustomToken } from '../../libs/portfolio/customToken'
import getAccountNetworksWithAssets from '../../libs/portfolio/getNetworksWithAssets'
import {
  getFlags,
  getPinnedGasTankTokens,
  getTokensReadyToLearn,
  getTotal,
  getUpdatedHints,
  processTokens,
  shouldGetAdditionalPortfolio,
  validateERC20Token
} from '../../libs/portfolio/helpers'
/* eslint-disable no-restricted-syntax */
// eslint-disable-next-line import/no-cycle
import {
  AccountState,
  GetOptions,
  NetworkState,
  PortfolioControllerState,
  PreviousHintsStorage,
  TemporaryTokens,
  TokenResult
} from '../../libs/portfolio/interfaces'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'

/* eslint-disable @typescript-eslint/no-shadow */

const LEARNED_TOKENS_NETWORK_LIMIT = 50

export class PortfolioController extends EventEmitter {
  #latest: PortfolioControllerState

  #pending: PortfolioControllerState

  // A queue to prevent race conditions when calling `updateSelectedAccount`.
  // All calls are queued by network and account.
  // Each time `updateSelectedAccount` is invoked to update the latest or pending state, the call is added to the queue.
  // If a previous call is still running, the new call will be queued and executed only after the first one completes,
  // regardless of whether it succeeds or fails.
  // Before implementing this queue, multiple `updateSelectedAccount` calls made in a short period of time could cause
  // the response of the latest call to be overwritten by a slower previous call.
  #queue: {
    [accountId: string]: {
      [networkId: NetworkId]: Promise<void>
    }
  }

  #toBeLearnedTokens: { [network in NetworkId]: string[] }

  tokenPreferences: CustomToken[] = []

  validTokens: any = { erc20: {}, erc721: {} }

  temporaryTokens: TemporaryTokens = {}

  #portfolioLibs: Map<string, Portfolio>

  #storage: Storage

  #fetch: Fetch

  #callRelayer: Function

  #velcroUrl: string

  #networksWithAssetsByAccounts: {
    [accountId: string]: NetworkId[]
  } = {}

  #minUpdateInterval: number = 20000 // 20 seconds

  /**
   * Hints stored in storage, divided into three categories:
   * - fromExternalAPI: Hints fetched from an external API, used when the external API response fails.
   * - learnedTokens: Hints of learned tokens, each with a timestamp indicating the last time the token was seen with a balance and not included in fromExternalAPI hints. This helps prioritize tokens not yet found by Velcro during cleansing.
   * - learnedNfts: Hints of learned NFTs.
   */
  #previousHints: PreviousHintsStorage = {
    fromExternalAPI: {},
    learnedTokens: {},
    learnedNfts: {}
  }

  #providers: ProvidersController

  #networks: NetworksController

  #accounts: AccountsController

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  constructor(
    storage: Storage,
    fetch: Fetch,
    providers: ProvidersController,
    networks: NetworksController,
    accounts: AccountsController,
    relayerUrl: string,
    velcroUrl: string
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
    this.temporaryTokens = {}
    this.#toBeLearnedTokens = {}

    this.#initialLoadPromise = this.#load()
  }

  async #load() {
    try {
      await this.#networks.initialLoadPromise
      await this.#accounts.initialLoadPromise
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

  async #updateNetworksWithAssets(accountId: AccountId, accountState: AccountState) {
    const storageStateByAccount = await this.#storage.get('networksWithAssetsByAccount', {})

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
    const states = {
      latest: this.#latest,
      pending: this.#pending
    }
    const accountState = states[stateKey][accountId]
    if (!accountState[network]) accountState[network] = { errors: [], isReady: false, isLoading }
    accountState[network]!.isLoading = isLoading
    if (error) accountState[network]!.criticalError = error
  }

  removeNetworkData(networkId: NetworkId) {
    for (const accountState of [this.#latest, this.#pending]) {
      for (const accountId of Object.keys(accountState)) {
        delete accountState[accountId][networkId]
      }
    }
    this.emitUpdate()
  }

  // make the pending results the same as the latest ones
  overridePendingResults(accountOp: AccountOp) {
    if (
      this.#pending[accountOp.accountAddr] &&
      this.#pending[accountOp.accountAddr][accountOp.networkId] &&
      this.#latest[accountOp.accountAddr] &&
      this.#latest[accountOp.accountAddr][accountOp.networkId]
    ) {
      this.#pending[accountOp.accountAddr][accountOp.networkId]!.result =
        this.#latest[accountOp.accountAddr][accountOp.networkId]!.result
      this.emitUpdate()
    }
  }

  async updateTokenValidationByStandard(
    token: { address: TokenResult['address']; networkId: TokenResult['networkId'] },
    accountId: AccountId
  ) {
    await this.#initialLoadPromise
    if (this.validTokens.erc20[`${token.address}-${token.networkId}`] === true) return

    const [isValid, standard]: [boolean, string] = (await validateERC20Token(
      token,
      accountId,
      this.#providers.providers[token.networkId]
    )) as [boolean, string]

    this.validTokens[standard] = {
      ...this.validTokens[standard],
      [`${token.address}-${token.networkId}`]: isValid
    }

    this.emitUpdate()
  }

  initializePortfolioLibIfNeeded(accountId: AccountId, networkId: NetworkId, network: Network) {
    const providers = this.#providers.providers
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
      this.#portfolioLibs.set(
        key,
        new Portfolio(this.#fetch, providers[network.id], network, this.#velcroUrl)
      )
    }
    return this.#portfolioLibs.get(key)!
  }

  async getTemporaryTokens(accountId: AccountId, networkId: NetworkId, additionalHint: string) {
    const network = this.#networks.networks.find((x) => x.id === networkId)

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
        additionalErc20Hints: [additionalHint, ...temporaryTokensToFetch.map((x) => x.address)],
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

  async #getAdditionalPortfolio(accountId: AccountId, forceUpdate?: boolean) {
    const rewardsOrGasTankState =
      this.#latest[accountId]?.rewards || this.#latest[accountId]?.gasTank
    const canSkipUpdate = rewardsOrGasTankState
      ? this.#getCanSkipUpdate(rewardsOrGasTankState, forceUpdate)
      : false

    if (canSkipUpdate) return

    const hasNonZeroTokens = !!this.#networksWithAssetsByAccounts?.[accountId]?.length
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

    if (!res) throw new Error('portfolio controller: no res, should never happen')

    const rewardsTokens = [
      res.data.rewards.xWalletClaimableBalance || [],
      res.data.rewards.walletClaimableBalance || []
    ]
      .flat()
      .map((t: any) => ({
        ...t,
        symbol: t.address === '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935' ? 'xWALLET' : t.symbol,
        flags: getFlags(res.data.rewards, 'rewards', t.networkId, t.address)
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
        lastSuccessfulUpdate: Date.now(),
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

  #getCanSkipUpdate(
    networkState?: NetworkState,
    forceUpdate?: boolean,
    maxDataAgeMs: number = this.#minUpdateInterval
  ) {
    const hasImportantErrors = networkState?.errors.some((e) => e.level === 'critical')

    if (forceUpdate || !networkState || networkState.criticalError || hasImportantErrors)
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
    portfolioLib: Portfolio,
    portfolioProps: Partial<GetOptions> & { blockTag: 'latest' | 'pending' },
    forceUpdate: boolean,
    maxDataAgeMs?: number
  ): Promise<boolean> {
    const blockTag = portfolioProps.blockTag
    const stateKeys = {
      latest: this.#latest,
      pending: this.#pending
    }
    const accountState = stateKeys[blockTag][accountId]
    if (!accountState[network.id]) {
      // isLoading must be false here, otherwise canSkipUpdate will return true
      // and portfolio will not be updated
      accountState[network.id] = { isLoading: false, isReady: false, errors: [] }
    }
    const canSkipUpdate = this.#getCanSkipUpdate(
      accountState[network.id],
      forceUpdate,
      maxDataAgeMs
    )

    if (canSkipUpdate) return false

    this.#setNetworkLoading(accountId, blockTag, network.id, true)
    this.emitUpdate()

    const state = accountState[network.id]!
    const tokenPreferences = this.tokenPreferences
    const hasNonZeroTokens = !!this.#networksWithAssetsByAccounts?.[accountId]?.length

    try {
      const result = await portfolioLib.get(accountId, {
        priceRecency: 60000,
        priceCache: state.result?.priceCache,
        fetchPinned: !hasNonZeroTokens,
        tokenPreferences,
        ...portfolioProps
      })

      const hasCriticalError = result.errors.some((e) => e.level === 'critical')
      const additionalHintsErc20Hints = portfolioProps.additionalErc20Hints || []
      let lastSuccessfulUpdate = accountState[network.id]?.result?.lastSuccessfulUpdate || 0

      // Reset lastSuccessfulUpdate on forceUpdate in case of critical errors as the user
      // is likely expecting a change in the portfolio.
      if (forceUpdate && hasCriticalError) {
        lastSuccessfulUpdate = 0
      } else if (!hasCriticalError) {
        // Update the last successful update only if there are no critical errors.
        lastSuccessfulUpdate = Date.now()
      }

      const processedTokens = processTokens(
        result.tokens,
        network,
        hasNonZeroTokens,
        additionalHintsErc20Hints,
        tokenPreferences
      )

      accountState[network.id] = {
        isReady: true,
        isLoading: false,
        errors: result.errors,
        result: {
          ...result,
          lastSuccessfulUpdate,
          tokens: processedTokens,
          total: getTotal(processedTokens)
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
      state.criticalError = e
      if (forceUpdate && state.result) {
        // Reset lastSuccessfulUpdate on forceUpdate in case of a critical error as the user
        // is likely expecting a change in the portfolio.
        state.result.lastSuccessfulUpdate = 0
      }
      this.emitUpdate()

      return false
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
    network?: Network,
    accountOps?: { [key: string]: AccountOp[] },
    opts?: { forceUpdate?: boolean; maxDataAgeMs?: number }
  ) {
    await this.#initialLoadPromise
    const selectedAccount = this.#accounts.accounts.find((x) => x.addr === accountId)
    if (!selectedAccount) throw new Error('selected account does not exist')
    if (!this.#latest[accountId]) this.#latest[accountId] = {}
    if (!this.#pending[accountId]) this.#pending[accountId] = {}

    const accountState = this.#latest[accountId]
    const pendingState = this.#pending[accountId]

    if (shouldGetAdditionalPortfolio(selectedAccount)) {
      this.#getAdditionalPortfolio(accountId, opts?.forceUpdate)
    }

    const networks = network ? [network] : this.#networks.networks
    await Promise.all(
      networks.map(async (network) => {
        const key = `${network.id}:${accountId}`

        const portfolioLib = this.initializePortfolioLibIfNeeded(accountId, network.id, network)

        const currentAccountOps = accountOps?.[network.id]?.filter(
          (op) => op.accountAddr === accountId
        )
        const simulatedAccountOps = pendingState[network.id]?.accountOps

        if (!this.#queue?.[accountId]?.[network.id])
          this.#queue[accountId] = {
            ...this.#queue[accountId],
            [network.id]: Promise.resolve()
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
          const forceUpdate = opts?.forceUpdate || areAccountOpsChanged

          const previousHintsFromExternalAPI = this.#previousHints?.fromExternalAPI?.[key]

          const additionalErc20Hints = [
            ...Object.keys(
              (this.#previousHints?.learnedTokens &&
                this.#previousHints?.learnedTokens[network.id]) ??
                {}
            ),
            ...((this.#toBeLearnedTokens && this.#toBeLearnedTokens[network.id]) ?? [])
          ]
          const additionalErc721Hints = Object.fromEntries(
            Object.entries(this.#previousHints?.learnedNfts?.[network.id] || {}).map(([k, v]) => [
              getAddress(k),
              { isKnown: false, tokens: v.map((i) => i.toString()) }
            ])
          )
          const allHints = {
            previousHintsFromExternalAPI,
            additionalErc20Hints,
            additionalErc721Hints
          }

          const [isSuccessfulLatestUpdate] = await Promise.all([
            // Latest state update
            this.updatePortfolioState(
              accountId,
              network,
              portfolioLib,
              {
                blockTag: 'latest',
                ...allHints
              },
              forceUpdate,
              opts?.maxDataAgeMs
            ),
            this.updatePortfolioState(
              accountId,
              network,
              portfolioLib,
              {
                blockTag: 'pending',
                ...(currentAccountOps && {
                  simulation: {
                    account: selectedAccount,
                    accountOps: currentAccountOps
                  }
                }),
                isEOA: !isSmartAccount(selectedAccount),
                ...allHints
              },
              forceUpdate,
              opts?.maxDataAgeMs
            )
          ])

          // Persist latest state in previousHints in the disk storage for further requests
          if (
            isSuccessfulLatestUpdate &&
            !areAccountOpsChanged &&
            accountState[network.id]?.result
          ) {
            const networkResult = accountState[network.id]!.result
            const readyToLearnTokens = getTokensReadyToLearn(
              this.#toBeLearnedTokens[network.id],
              networkResult!.tokens
            )

            if (readyToLearnTokens.length) {
              await this.learnTokens(readyToLearnTokens, network.id)
            }

            // Either a valid response or there is no external API to fetch hints from
            const isExternalHintsApiResponseValid =
              !!networkResult?.hintsFromExternalAPI || !network.hasRelayer

            if (isExternalHintsApiResponseValid) {
              const updatedStoragePreviousHints = getUpdatedHints(
                networkResult!.hintsFromExternalAPI || null,
                networkResult!.tokens,
                networkResult!.tokenErrors,
                network.id,
                this.#previousHints,
                key,
                this.tokenPreferences
              )

              // Updating hints is only needed when the external API response is valid.
              // learnTokens and learnNfts update storage separately, so we don't need to update them here
              // if the external API response is invalid.
              this.#previousHints = updatedStoragePreviousHints
              await this.#storage.set('previousHints', updatedStoragePreviousHints)
            }
          }

          // We cache the previously simulated AccountOps
          // in order to compare them with the newly passed AccountOps before executing a new updatePortfolioState.
          // This allows us to identify any differences between the two.
          if (currentAccountOps) {
            pendingState[network.id]!.accountOps = currentAccountOps
          }
        }

        // Chain the new updatePromise to the current queue
        this.#queue[accountId][network.id] = this.#queue[accountId][network.id]
          .then(updatePromise)
          .catch(() => updatePromise())

        // Ensure the method waits for the entire queue to resolve
        await this.#queue[accountId][network.id]
      })
    )

    await this.#updateNetworksWithAssets(accountId, accountState)
    this.emitUpdate()
  }

  markSimulationAsBroadcasted(accountId: string, networkId: string) {
    const simulation = this.#pending[accountId][networkId]?.accountOps?.[0]

    if (!simulation) return

    simulation.status = AccountOpStatus.BroadcastedButNotConfirmed

    this.emitUpdate()
  }

  addTokensToBeLearned(tokenAddresses: string[], networkId: NetworkId) {
    if (!tokenAddresses.length) return false
    if (!this.#toBeLearnedTokens[networkId]) this.#toBeLearnedTokens[networkId] = []

    let networkToBeLearnedTokens = this.#toBeLearnedTokens[networkId]

    const alreadyLearned = networkToBeLearnedTokens.map((addr) => getAddress(addr))

    const tokensToLearn = tokenAddresses.filter((address) => {
      let normalizedAddress
      try {
        normalizedAddress = getAddress(address)
      } catch (e) {
        console.error('Error while normalizing token address', e)
      }

      return normalizedAddress && !alreadyLearned.includes(normalizedAddress)
    })

    if (!tokensToLearn.length) return false

    networkToBeLearnedTokens = [...tokensToLearn, ...networkToBeLearnedTokens]

    this.#toBeLearnedTokens[networkId] = networkToBeLearnedTokens
    return true
  }

  // Learn new tokens from humanizer and debug_traceCall
  // return: whether new tokens have been learned
  async learnTokens(tokenAddresses: string[] | undefined, networkId: NetworkId): Promise<boolean> {
    if (!tokenAddresses) return false

    if (!this.#previousHints.learnedTokens) this.#previousHints.learnedTokens = {}

    let networkLearnedTokens: PreviousHintsStorage['learnedTokens'][''] =
      this.#previousHints.learnedTokens[networkId] || {}

    const alreadyLearned = Object.keys(networkLearnedTokens).map((addr) => getAddress(addr))

    const tokensToLearn = tokenAddresses.reduce((acc: { [key: string]: null }, address) => {
      if (address === ZeroAddress) return acc
      if (alreadyLearned.includes(getAddress(address))) return acc

      acc[address] = acc[address] || null // Keep the timestamp of all learned tokens
      return acc
    }, {})

    if (!Object.keys(tokensToLearn).length) return false
    // Add new tokens in the beginning of the list
    networkLearnedTokens = { ...tokensToLearn, ...networkLearnedTokens }

    // Reached limit
    if (LEARNED_TOKENS_NETWORK_LIMIT - Object.keys(networkLearnedTokens).length < 0) {
      // Convert learned tokens into an array of [address, timestamp] pairs and sort by timestamp in descending order.
      // This ensures that tokens with the most recent timestamps are prioritized for retention,
      // and tokens with the oldest timestamps are deleted last when the limit is exceeded.
      const learnedTokensArray = Object.entries(networkLearnedTokens).sort(
        (a, b) => Number(b[1]) - Number(a[1])
      )

      networkLearnedTokens = Object.fromEntries(
        learnedTokensArray.slice(0, LEARNED_TOKENS_NETWORK_LIMIT)
      )
    }

    this.#previousHints.learnedTokens[networkId] = networkLearnedTokens
    await this.#storage.set('previousHints', this.#previousHints)
    return true
  }

  async learnNfts(
    nftsData: [string, bigint[]][] | undefined,
    networkId: NetworkId
  ): Promise<boolean> {
    if (!nftsData?.length) return false
    if (!this.#previousHints.learnedNfts) this.#previousHints.learnedNfts = {}
    const networkLearnedNfts: PreviousHintsStorage['learnedNfts'][''] =
      this.#previousHints.learnedNfts[networkId] || {}

    const newAddrToId = nftsData.map(([addr, ids]) => ids.map((id) => `${addr}:${id}`)).flat()
    const alreadyLearnedAddrToId = Object.entries(networkLearnedNfts)
      .map(([addr, ids]) => ids.map((id) => `${addr}:${id}`))
      .flat()
    if (newAddrToId.every((i) => alreadyLearnedAddrToId.includes(i))) return false
    nftsData.forEach(([addr, ids]) => {
      if (addr === ZeroAddress) return
      if (!networkLearnedNfts[addr]) networkLearnedNfts[addr] = ids
      else networkLearnedNfts[addr] = Array.from(new Set([...ids, ...networkLearnedNfts[addr]]))
    })

    this.#previousHints.learnedNfts[networkId] = networkLearnedNfts
    await this.#storage.set('previousHints', this.#previousHints)
    return true
  }

  removeAccountData(address: Account['addr']) {
    delete this.#latest[address]
    delete this.#pending[address]
    delete this.#networksWithAssetsByAccounts[address]

    this.#networks.networks.forEach((network) => {
      const key = `${network.id}:${address}`

      if (key in this.#previousHints.fromExternalAPI) {
        delete this.#previousHints.fromExternalAPI[key]
      }
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

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
