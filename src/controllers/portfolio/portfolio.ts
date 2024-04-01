/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable @typescript-eslint/no-shadow */
import { CustomToken } from 'libs/portfolio/customToken'
import fetch from 'node-fetch'

import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Account, AccountId } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { isSmartAccount } from '../../libs/account/account'
import { AccountOp, isAccountOpsIntentEqual } from '../../libs/accountOp/accountOp'
/* eslint-disable no-restricted-syntax */
// eslint-disable-next-line import/no-cycle
import {
  getNetworksWithFailedRPCBanners,
  getNetworksWithPortfolioErrorBanners
} from '../../libs/banners/banners'
import getAccountNetworksWithAssets from '../../libs/portfolio/getNetworksWithAssets'
import { getFlags, validateERC20Token } from '../../libs/portfolio/helpers'
/* eslint-disable no-param-reassign */
/* eslint-disable import/no-extraneous-dependencies */
import { getIcon, getIconId } from '../../libs/portfolio/icons'
import {
  AccountState,
  AdditionalAccountState,
  GetOptions,
  Hints,
  PortfolioControllerState,
  PortfolioGetResult,
  TokenIcon,
  TokenResult
} from '../../libs/portfolio/interfaces'
import { Portfolio } from '../../libs/portfolio/portfolio'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import EventEmitter from '../eventEmitter/eventEmitter'
/* eslint-disable @typescript-eslint/no-shadow */
import { SettingsController } from '../settings/settings'

/* eslint-disable @typescript-eslint/no-use-before-define */
// We already know that `results.tokens` and `result.collections` tokens have a balance (this is handled by the portfolio lib).
// Based on that, we can easily find out which hint tokens also have a balance.
function getHintsWithBalance(
  result: PortfolioGetResult
  // keepPinned: boolean,
  // additionalHints: GetOptions['additionalHints'] = []
): {
  erc20s: Hints['erc20s']
  erc721s: Hints['erc721s']
} {
  const erc20s = result.tokens
    // .filter((token) => {
    //   return (
    //     token.amount > 0n ||
    //     additionalHints.includes(token.address) ||
    //     // Delete pinned tokens' hints if the user has > 1 non-zero tokens
    //     (keepPinned &&
    //       PINNED_TOKENS.find(
    //         (pinnedToken) =>
    //           pinnedToken.address === token.address && pinnedToken.networkId === token.networkId
    //       ))
    //   )
    // })
    .map((token) => token.address)

  const erc721s = Object.fromEntries(
    result.collections.map((collection) => [
      collection.address,
      result.hints.erc721s[collection.address]
    ])
  )

  return {
    erc20s,
    erc721s
  }
}

export class PortfolioController extends EventEmitter {
  latest: PortfolioControllerState

  pending: PortfolioControllerState

  tokenPreferences: CustomToken[] = []

  validTokens: any = { erc20: {}, erc721: {} }

  #portfolioLibs: Map<string, Portfolio>

  #storage: Storage

  #callRelayer: Function

  #networksWithAssetsByAccounts: {
    [accountId: string]: NetworkDescriptor['id'][]
  } = {}

  #minUpdateInterval: number = 20000 // 20 seconds

  #additionalHints: GetOptions['additionalHints'] = []

  #settings: SettingsController

  tokenIcons: TokenIcon

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
    this.tokenIcons = {}

    this.#initialLoadPromise = this.#load()
  }

  async #load() {
    try {
      this.tokenPreferences = await this.#storage.get('tokenPreferences', [])
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
    const accountState = this.latest[accountId] as AdditionalAccountState
    if (!accountState[network]) accountState[network] = { errors: [], isReady: false, isLoading }
    accountState[network]!.isLoading = isLoading
    if (!error) {
      if (!accountState[network]!.isReady) accountState[network]!.criticalError = error
      else accountState[network]!.errors.push(error)
    }
  }

  resetAdditionalHints() {
    this.#additionalHints = []
  }

  async updateTokenValidationByStandard(
    token: { address: TokenResult['address']; networkId: TokenResult['networkId'] },
    accountId: AccountId
  ) {
    const network = this.#settings.networks.find((net) => net.id === token.networkId)
    if (!network) return

    const [isValid, standard, symbol, amount, decimals, priceIn]: [
      boolean,
      string,
      string,
      number,
      number,
      { baseCurrency: string; price: number }[]
    ] = await validateERC20Token(
      token,
      accountId,
      this.#settings.providers[token.networkId],
      network
    )

    this.validTokens[standard] = {
      ...this.validTokens[standard],
      [`${token.address}-${token.networkId}`]: {
        isValid,
        symbol,
        amount,
        decimals,
        priceIn
      }
    }

    this.emitUpdate()
  }

  async getAdditionalPortfolio(accountId: AccountId) {
    if (!this.latest[accountId]) this.latest[accountId] = {}
    const hasNonZeroTokens = !!this.#networksWithAssetsByAccounts?.[accountId]?.length

    const start = Date.now()
    const accountState = this.latest[accountId] as AdditionalAccountState

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

    const getTotal = (t: any[]) =>
      t.reduce((cur: any, token: any) => {
        for (const x of token.priceIn) {
          cur[x.baseCurrency] =
            (cur[x.baseCurrency] || 0) + (Number(token.amount) / 10 ** token.decimals) * x.price
        }

        return cur
      }, {})

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

    let pinnedGasTankTokens: TokenResult[] = []

    // Don't set pinnedGasTankTokens if the user has > 1 non-zero tokens
    if (res.data.gasTank.availableGasTankAssets && !hasNonZeroTokens) {
      const availableGasTankAssets = res.data.gasTank.availableGasTankAssets

      pinnedGasTankTokens = availableGasTankAssets.reduce((acc: TokenResult[], token: any) => {
        const isGasTankToken = !!gasTankTokens.find(
          (gasTankToken: TokenResult) =>
            gasTankToken.symbol.toLowerCase() === token.symbol.toLowerCase()
        )
        const isAlreadyPinned = !!acc.find(
          (accToken) => accToken.symbol.toLowerCase() === token.symbol.toLowerCase()
        )

        if (isGasTankToken || isAlreadyPinned) return acc

        const correspondingPinnedToken = PINNED_TOKENS.find(
          (pinnedToken) =>
            (!('accountId' in pinnedToken) || pinnedToken.accountId === accountId) &&
            pinnedToken.address === token.address &&
            pinnedToken.networkId === token.network
        )

        if (correspondingPinnedToken && correspondingPinnedToken.onGasTank) {
          acc.push({
            address: token.address,
            symbol: token.symbol.toUpperCase(),
            amount: 0n,
            networkId: correspondingPinnedToken.networkId,
            decimals: token.decimals,
            priceIn: [
              {
                baseCurrency: 'usd',
                price: token.price
              }
            ],
            flags: {
              rewardsType: null,
              canTopUpGasTank: true,
              isFeeToken: true,
              onGasTank: true
            }
          })
        }
        return acc
      }, [])
    }

    accountState.gasTank = {
      isReady: true,
      isLoading: false,
      errors: [],
      result: {
        updateStarted: start,
        tokens: [...gasTankTokens, ...pinnedGasTankTokens],
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
      additionalHints?: GetOptions['additionalHints']
    }
  ) {
    await this.#initialLoadPromise

    if (opts?.additionalHints) this.#additionalHints = opts.additionalHints
    const hasNonZeroTokens = !!this.#networksWithAssetsByAccounts?.[accountId]?.length
    // Load storage cached hints
    const storagePreviousHints = await this.#storage.get('previousHints', {})

    const selectedAccount = accounts.find((x) => x.addr === accountId)
    if (!selectedAccount) throw new Error('selected account does not exist')

    const prepareState = (state: PortfolioControllerState): void => {
      if (!state[accountId]) state[accountId] = {}

      const accountState = state[accountId]
      for (const networkId of Object.keys(accountState)) {
        if (![...networks, { id: 'gasTank' }, { id: 'rewards' }].find((x) => x.id === networkId))
          delete accountState[networkId]
      }
      this.emitUpdate()
    }

    prepareState(this.latest)
    prepareState(this.pending)
    const accountState = this.latest[accountId]
    const pendingState = this.pending[accountId]

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
        _accountState[network.id] = { isReady: true, isLoading: false, errors: [], result }
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
        const providers = this.#settings.providers
        const key = `${network.id}:${accountId}`
        // Initialize a new Portfolio lib if:
        // 1. It does not exist in the portfolioLibs map
        // 2. The network RPC URL has changed
        if (
          !this.#portfolioLibs.has(key) ||
          this.#portfolioLibs.get(key)?.network?.rpcUrl !==
            // eslint-disable-next-line no-underscore-dangle
            providers[network.id]?._getConnection().url
        ) {
          this.#portfolioLibs.set(key, new Portfolio(fetch, providers[network.id], network))
        }
        const portfolioLib = this.#portfolioLibs.get(key)!

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

        const [isSuccessfulLatestUpdate] = await Promise.all([
          // Latest state update
          updatePortfolioState(
            accountState,
            network,
            portfolioLib,
            {
              blockTag: 'latest',
              previousHints: storagePreviousHints[key],
              additionalHints: this.#additionalHints
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
                  previousHints: storagePreviousHints[key],
                  ...(currentAccountOps && {
                    simulation: {
                      account: selectedAccount,
                      accountOps: currentAccountOps
                    }
                  }),
                  isEOA: !isSmartAccount(selectedAccount),
                  additionalHints: this.#additionalHints
                },
                forceUpdate
              )
            : Promise.resolve(false)
        ])

        // Persist previousHints in the disk storage for further requests, when:
        // latest state was updated successful and hints were fetched successful too (no hintsError from portfolio result)
        if (isSuccessfulLatestUpdate && !accountState[network.id]!.result!.hintsError) {
          storagePreviousHints[key] = getHintsWithBalance(
            accountState[network.id]!.result!
            // !hasNonZeroTokens,
            // this.#additionalHints
          )
          await this.#storage.set('previousHints', storagePreviousHints)
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

    const tokenResults: TokenResult[] = []
    for (const networkId of Object.keys(accountState)) {
      const tokenResult = accountState[networkId]?.result?.tokens
      if (tokenResult) {
        tokenResults.push(...tokenResult)
      }
    }

    // start a request for fetching the token icons after a successful update
    this.getTokenIcons(tokenResults).catch((e) => {
      // Icons are not so important so they should not stop the execution
      this.emitError({
        level: 'silent',
        message: 'Error while fetching the token icons',
        error: e
      })
    })

    await this.#updateNetworksWithAssets(accounts, accountId, accountState)

    this.emitUpdate()
  }

  async getTokenIcons(tokens: PortfolioGetResult['tokens']) {
    const storage = await this.#storage.get('tokenIcons', {})
    const settingsNetworks = this.#settings.networks

    const promises = tokens.map(async (token) => {
      const icon = await getIcon(
        settingsNetworks.find((net) => net.id === token.networkId)!,
        token.address,
        storage
      )
      if (!icon) return null
      return { [getIconId(token.networkId, token.address)]: icon }
    })

    const result = await Promise.all(promises)
    result
      .filter((icon) => icon) // remove nulls
      .forEach((icon: any) => {
        this.tokenIcons[Object.keys(icon)[0] as string] = Object.values(icon)[0] as string
      })

    await this.#storage.set('tokenIcons', this.tokenIcons)
    this.emitUpdate()
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
