/* eslint-disable no-underscore-dangle */
import { formatEther, getAddress, isAddress } from 'ethers'

import { STK_WALLET, UNI_V3_WALLET_WETH_POOL, WALLET_TOKEN } from '../../consts/addresses'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { Account, IAccountsController } from '../../interfaces/account'
import { AutoLoginPolicy, IAutoLoginController } from '../../interfaces/autoLogin'
import { Banner } from '../../interfaces/banner'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { INetworksController } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import {
  ISelectedAccountController,
  SelectedAccountPortfolio
} from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import { isSmartAccount } from '../../libs/account/account'
import {
  defiPositionsOnDisabledNetworksBannerId,
  getDefiPositionsOnDisabledNetworksForTheSelectedAccount
} from '../../libs/banners/banners'
import { AssetType } from '../../libs/defiPositions/types'
import {
  getNetworksWithDeFiPositionsErrorErrors,
  getNetworksWithErrors,
  SelectedAccountBalanceError
} from '../../libs/selectedAccount/errors'
import {
  calculateSelectedAccountPortfolio,
  DEFAULT_SELECTED_ACCOUNT_PORTFOLIO
} from '../../libs/selectedAccount/selectedAccount'
import { getProjectedRewardsStatsAndToken } from '../../utils/rewards'
import EventEmitter from '../eventEmitter/eventEmitter'

export class SelectedAccountController extends EventEmitter implements ISelectedAccountController {
  #storage: IStorageController

  #accounts: IAccountsController

  #autoLogin: IAutoLoginController

  #portfolio: IPortfolioController | null = null

  #networks: INetworksController | null = null

  #providers: IProvidersController | null = null

  account: Account | null = null

  /**
   * Holds the selected account portfolio that is used by the UI to display the portfolio.
   * It includes the portfolio and defi positions for the selected account.
   * It is updated when the portfolio or defi positions controllers are updated.
   */
  portfolio: SelectedAccountPortfolio = DEFAULT_SELECTED_ACCOUNT_PORTFOLIO

  #portfolioLoadingTimeout: NodeJS.Timeout | null = null

  #isManualUpdate = true

  dashboardNetworkFilter: bigint | string | null = null

  #shouldDebounceFlags: { [key: string]: boolean } = {}

  balanceAffectingErrors: SelectedAccountBalanceError[] = []

  isReady: boolean = false

  areControllersInitialized: boolean = false

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  dismissedBannerIds: { [key: string]: string[] } = {}

  constructor({
    eventEmitterRegistry,
    storage,
    accounts,
    autoLogin
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    storage: IStorageController
    accounts: IAccountsController
    autoLogin: IAutoLoginController
  }) {
    super(eventEmitterRegistry)

    this.#storage = storage
    this.#accounts = accounts
    this.#autoLogin = autoLogin

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    await this.#accounts.initialLoadPromise

    const [selectedAccountAddress, selectedAccountDismissedBannerIds] = await Promise.all([
      this.#storage.get('selectedAccount', null),
      this.#storage.get('selectedAccountDismissedBannerIds', [])
    ])
    this.dismissedBannerIds = selectedAccountDismissedBannerIds
    this.account = this.#accounts.accounts.find((a) => a.addr === selectedAccountAddress) || null
    this.isReady = true

    this.emitUpdate()
  }

  initControllers({
    portfolio,
    networks,
    providers
  }: {
    portfolio: IPortfolioController
    networks: INetworksController
    providers: IProvidersController
  }) {
    this.#portfolio = portfolio
    this.#networks = networks
    this.#providers = providers

    this.updateSelectedAccountPortfolio(true)
    this.#updatePortfolioErrors(true)

    this.#portfolio.onUpdate(async () => {
      this.#debounceFunctionCallsOnSameTick('updateSelectedAccountPortfolio', () => {
        this.updateSelectedAccountPortfolio()
      })
    }, 'selectedAccount')

    this.#providers.onUpdate(() => {
      this.#debounceFunctionCallsOnSameTick('updateErrors', () => {
        this.#updatePortfolioErrors()
      })
    })

    this.#accounts.onUpdate(() => {
      this.#debounceFunctionCallsOnSameTick('updateSelectedAccount', () => {
        this.#updateSelectedAccount(true)
        this.#updatePortfolioErrors()
      })
    })

    this.#autoLogin.onUpdate((forceEmit) => {
      if (this.account) {
        this.propagateUpdate(forceEmit)
      }
    })

    this.areControllersInitialized = true

    this.emitUpdate()
  }

  async setAccount(account: Account | null) {
    this.account = account
    this.balanceAffectingErrors = []
    this.resetSelectedAccountPortfolio({ skipUpdate: true })

    const isStateWithOutdatedNetworks =
      this.account &&
      this.#portfolio &&
      this.#portfolio.getIsStateWithOutdatedNetworks(this.account.addr)

    // Display the current portfolio state immediately only if the user hasn't
    // added/removed networks since the last time the portfolio was calculated.
    if (!isStateWithOutdatedNetworks) {
      this.updateSelectedAccountPortfolio(true)
    }
    this.dashboardNetworkFilter = null
    if (this.#portfolioLoadingTimeout) clearTimeout(this.#portfolioLoadingTimeout)
    this.#portfolioLoadingTimeout = null

    this.emitUpdate()

    if (!account) {
      await this.#storage.remove('selectedAccount')
    } else {
      await this.#storage.set('selectedAccount', account.addr)
    }
  }

  #updateSelectedAccount(skipUpdate: boolean = false) {
    if (!this.account) return

    const updatedAccount = this.#accounts.accounts.find((a) => a.addr === this.account!.addr)
    if (!updatedAccount) return

    this.account = updatedAccount

    if (!skipUpdate) this.emitUpdate()
  }

  resetSelectedAccountPortfolio({
    isManualUpdate,
    skipUpdate
  }: { isManualUpdate?: boolean; skipUpdate?: boolean } = {}) {
    if (!this.#portfolio || !this.account) return

    if (isManualUpdate) {
      this.#isManualUpdate = true
    }

    this.portfolio = DEFAULT_SELECTED_ACCOUNT_PORTFOLIO
    this.balanceAffectingErrors = []

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  updateSelectedAccountPortfolio(skipUpdate?: boolean) {
    if (!this.#portfolio || !this.account) return

    const portfolioAccountState = structuredClone(
      this.#portfolio.getAccountPortfolioState(this.account.addr)
    )

    const newSelectedAccountPortfolio = calculateSelectedAccountPortfolio(
      portfolioAccountState,
      this.portfolio.shouldShowPartialResult,
      this.#isManualUpdate
    )

    // Try catch this just in case the relayer sends unexpected data or we have other errs in the calculations
    try {
      // Find stkWALLET or WALLET token in the latest portfolio state
      const walletOrStkWalletTokenPrice = portfolioAccountState['1']?.result?.tokens.find(
        ({ address }) => address === STK_WALLET || address === WALLET_TOKEN
      )?.priceIn?.[0]?.price

      const ethTokenPrice = portfolioAccountState['1']?.result?.tokens.find(
        ({ symbol }) => symbol === 'ETH'
      )?.priceIn?.[0]?.price

      const stkTokenInPortfolio = portfolioAccountState['1']?.result?.tokens.find(
        ({ address }) => address === STK_WALLET
      )
      const stkBalanceUsd =
        stkTokenInPortfolio === undefined || stkTokenInPortfolio.priceIn[0]?.price === undefined
          ? undefined
          : Number(formatEther(stkTokenInPortfolio.amount)) * stkTokenInPortfolio.priceIn[0].price

      const walletEthProvidedLiquidityInUsd = portfolioAccountState[
        '1'
      ]?.result?.defiPositions.positionsByProvider
        .find((p) => p.providerName === 'Uniswap V3')
        ?.positions.filter(
          (p) =>
            p.additionalData.inRange &&
            isAddress(p.additionalData.pool?.id) &&
            getAddress(p.additionalData.pool.id) === UNI_V3_WALLET_WETH_POOL
        )
        .map((p) => p.assets)
        .flat()
        // assets in the uniswap positions can have asset type of liquidity or rewards
        // we remove the latter because the rewards app does not fetch anything
        // from debank, and is only able to get the assets with liquidity type for the
        // uniswap liquidity position. To achieve minimal discrepancy between the
        // extension and the app, we will not include assets with type Reward for the
        // uniswap liquidity position
        .filter((a) => a.type === AssetType.Liquidity)
        .map((a) => {
          const tokenPriceFromPosition = a.priceIn?.price
          const tokenPriceFromPortfolio =
            a.address === WALLET_TOKEN ? walletOrStkWalletTokenPrice : ethTokenPrice
          const tokenPriceToUse = tokenPriceFromPosition || tokenPriceFromPortfolio
          if (tokenPriceToUse === undefined) return undefined

          return tokenPriceToUse * Number(formatEther(a.amount))
        })
        .reduce((a, b) => (a === undefined || b === undefined ? undefined : a + b), 0)

      const currentBalance = Object.entries(this.portfolio.balancePerNetwork)
        .filter(([k]) =>
          portfolioAccountState.projectedRewards?.result?.supportedChainIds
            .map((n) => n.toString())
            .includes(k)
        )
        .map(([, v]): number => v)
        .reduce((a, b) => a + b, 0)

      if (portfolioAccountState.projectedRewards) {
        const projectedRewardsData = getProjectedRewardsStatsAndToken(
          portfolioAccountState.projectedRewards,
          walletOrStkWalletTokenPrice,
          currentBalance,
          stkBalanceUsd,
          walletEthProvidedLiquidityInUsd
        )

        // Calculate and add projected rewards token
        if (projectedRewardsData) {
          newSelectedAccountPortfolio.tokens.push(projectedRewardsData?.token)

          newSelectedAccountPortfolio.projectedRewardsStats = projectedRewardsData.data
        }
      }
    } catch (e) {
      this.emitError({
        level: 'silent',
        message: 'Should NEVER happen: Error while calculating projected rewards stats',
        error: e as Error
      })
    }

    // Reset the loading timestamp if the portfolio is ready
    if (this.#portfolioLoadingTimeout && newSelectedAccountPortfolio.isAllReady) {
      clearTimeout(this.#portfolioLoadingTimeout)
      this.#portfolioLoadingTimeout = null
    }

    // Set the loading timestamp when the portfolio starts loading
    if (!this.#portfolioLoadingTimeout && !newSelectedAccountPortfolio.isAllReady) {
      this.#portfolioLoadingTimeout = setTimeout(() => {
        this.portfolio.shouldShowPartialResult = true
        this.updateSelectedAccountPortfolio()
        this.#portfolioLoadingTimeout = null
      }, 5000)
    }

    // Reset isManualUpdate flag when the portfolio has finished the initial load
    if (this.#isManualUpdate && newSelectedAccountPortfolio.isAllReady) {
      this.#isManualUpdate = false
      this.portfolio.shouldShowPartialResult = false
    }

    this.portfolio = newSelectedAccountPortfolio
    this.#updatePortfolioErrors(true)

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  #debounceFunctionCallsOnSameTick(funcName: string, func: () => void) {
    if (this.#shouldDebounceFlags[funcName]) return
    this.#shouldDebounceFlags[funcName] = true

    // Debounce multiple calls in the same tick and only execute one of them
    setTimeout(() => {
      this.#shouldDebounceFlags[funcName] = false
      try {
        func()
      } catch (error: any) {
        this.emitError({
          level: 'silent',
          message: `The execution of ${funcName} in SelectedAccountController failed`,
          error
        })
      }
    }, 0)
  }

  #updatePortfolioErrors(skipUpdate?: boolean) {
    if (
      !this.account ||
      !this.#networks ||
      !this.#providers ||
      !this.#portfolio ||
      (!this.portfolio.isAllReady && !this.portfolio.shouldShowPartialResult)
    ) {
      this.balanceAffectingErrors = []
      if (!skipUpdate) {
        this.emitUpdate()
      }
      return
    }

    this.balanceAffectingErrors = [
      ...getNetworksWithErrors({
        networks: this.#networks.networks,
        shouldShowPartialResult: this.portfolio.shouldShowPartialResult,
        selectedAccountPortfolioState: this.portfolio.portfolioState,
        isAllReady: this.portfolio.isAllReady,
        accountState: this.#accounts.accountStates[this.account.addr] || {},
        providers: this.#providers.providers,
        networksWithAssets: this.#portfolio.getNetworksWithAssets(this.account.addr)
      }),
      ...getNetworksWithDeFiPositionsErrorErrors({
        networks: this.#networks.networks,
        portfolioState: this.portfolio.portfolioState,
        providers: this.#providers.providers,
        networksWithPositions: this.#portfolio.getNetworksWithDefiPositions(this.account.addr)
      })
    ].sort((a, b) => {
      const order = { error: 0, warning: 1 } as const
      return order[a.type] - order[b.type]
    })

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  get deprecatedSmartAccountBanner(): Banner[] {
    if (!this.account || !isSmartAccount(this.account)) return []

    if (!this.#accounts.accountStates[this.account.addr]?.['1']?.isV2) return []

    if (
      !this.account.creation ||
      getAddress(this.account.creation.factoryAddr) === AMBIRE_ACCOUNT_FACTORY
    )
      return []

    return [
      {
        id: 'old-account',
        meta: {
          accountAddr: this.account.addr
        },
        type: 'warning',
        category: 'old-account',
        title: 'Old Ambire Account',
        text: "The account you are using is an old Ambire Account that was intended for testing the extension only. Fee options aren't available on custom networks. It won't be supported in the future. Please migrate to another by creating a new smart account in the extension or contact the team for support",
        actions: []
      }
    ]
  }

  get autoLoginPolicies(): AutoLoginPolicy[] {
    if (!this.account) return []

    return this.#autoLogin.getAccountPolicies(this.account.addr, true)
  }

  setDashboardNetworkFilter(networkFilter: bigint | string | null) {
    this.dashboardNetworkFilter = networkFilter
    this.emitUpdate()
  }

  removeNetworkData(chainId: bigint) {
    const stringChainId = chainId.toString()

    if (String(this.dashboardNetworkFilter) === stringChainId) {
      this.dashboardNetworkFilter = null
    }

    this.updateSelectedAccountPortfolio()
  }

  async dismissDefiPositionsBannerForTheSelectedAccount() {
    if (!this.account) return

    const defiBanner = this.banners.find((b) => b.id === defiPositionsOnDisabledNetworksBannerId)
    if (!defiBanner) return

    const action = defiBanner.actions.find((a) => a.actionName === 'enable-networks')
    if (!action) return

    if (!this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId])
      this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId] = []

    action.meta.networkChainIds.forEach((chainId) => {
      if (
        this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId]!.includes(
          `${this.account!.addr}-${chainId}`
        )
      )
        return
      this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId]!.push(
        `${this.account!.addr}-${chainId}`
      )
    })

    await this.#storage.set('selectedAccountDismissedBannerIds', this.dismissedBannerIds)
    this.emitUpdate()
  }

  // ! IMPORTANT !
  // Banners that depend on async data from sub-controllers should be implemented
  // in the sub-controllers themselves. This is because updates in the sub-controllers
  // will not trigger emitUpdate in the MainController, therefore the banners will
  // remain the same until a subsequent update in the MainController.
  get banners(): Banner[] {
    if (
      !this.account ||
      !this.#networks ||
      !this.#portfolio ||
      !this.#networks.isInitialized ||
      !this.portfolio.isAllReady
    )
      return []

    const defiPositionsCountOnDisabledNetworks =
      this.#portfolio.defiPositionsCountOnDisabledNetworks[this.account.addr] || {}

    const notDismissedNetworks = this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId]
      ? this.#networks.allNetworks.filter(
          (n) =>
            !this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId]?.includes(
              `${this.account!.addr}-${n.chainId}`
            )
        )
      : this.#networks.allNetworks

    return getDefiPositionsOnDisabledNetworksForTheSelectedAccount({
      defiPositionsCountOnDisabledNetworks,
      networks: notDismissedNetworks,
      accountAddr: this.account.addr
    })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      banners: this.banners,
      deprecatedSmartAccountBanner: this.deprecatedSmartAccountBanner,
      autoLoginPolicies: this.autoLoginPolicies
    }
  }
}
