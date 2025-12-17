/* eslint-disable no-underscore-dangle */
import { getAddress } from 'ethers'

import { STK_WALLET, WALLET_TOKEN } from '../../consts/addresses'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { Account, IAccountsController } from '../../interfaces/account'
import { AutoLoginPolicy, IAutoLoginController } from '../../interfaces/autoLogin'
import { Banner } from '../../interfaces/banner'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import {
  ISelectedAccountController,
  SelectedAccountPortfolio
} from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import { isSmartAccount } from '../../libs/account/account'
import { defiPositionsOnDisabledNetworksBannerId } from '../../libs/banners/banners'
import {
  getNetworksWithDeFiPositionsErrorErrors,
  getNetworksWithErrors,
  SelectedAccountBalanceError
} from '../../libs/selectedAccount/errors'
import { calculateSelectedAccountPortfolio } from '../../libs/selectedAccount/selectedAccount'
import { getProjectedRewardsStatsAndToken } from '../../utils/rewards'
import EventEmitter from '../eventEmitter/eventEmitter'

export const DEFAULT_SELECTED_ACCOUNT_PORTFOLIO = {
  tokens: [],
  collections: [],
  defiPositions: [],
  tokenAmounts: [],
  totalBalance: 0,
  balancePerNetwork: {},
  isReadyToVisualize: false,
  isAllReady: false,
  shouldShowPartialResult: false,
  isReloading: false,
  networkSimulatedAccountOp: {},
  portfolioState: {},
  projectedRewardsStats: null
}

export class SelectedAccountController extends EventEmitter implements ISelectedAccountController {
  #storage: IStorageController

  #accounts: IAccountsController

  #autoLogin: IAutoLoginController

  #portfolio: IPortfolioController | null = null

  #networks: INetworksController | null = null

  #keystore: IKeystoreController | null = null

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

  #portfolioErrors: SelectedAccountBalanceError[] = []

  #defiPositionsErrors: SelectedAccountBalanceError[] = []

  isReady: boolean = false

  areControllersInitialized: boolean = false

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  dismissedBannerIds: { [key: string]: string[] } = {}

  constructor({
    storage,
    accounts,
    keystore,
    autoLogin
  }: {
    storage: IStorageController
    accounts: IAccountsController
    keystore: IKeystoreController
    autoLogin: IAutoLoginController
  }) {
    super()

    this.#storage = storage
    this.#accounts = accounts
    this.#keystore = keystore
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
        this.#updatePortfolioErrors(true)
      })
    })

    this.#accounts.onUpdate(() => {
      this.#debounceFunctionCallsOnSameTick('updateSelectedAccount', () => {
        this.#updateSelectedAccount(true)
        this.#updatePortfolioErrors(true)
      })
    })

    this.#autoLogin.onUpdate(() => {
      if (this.account) {
        this.emitUpdate()
      }
    })

    this.areControllersInitialized = true

    this.emitUpdate()
  }

  async setAccount(account: Account | null) {
    this.account = account
    this.#portfolioErrors = []
    this.#defiPositionsErrors = []
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
    this.#portfolioErrors = []

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

    // Find stkWALLET or WALLET token in the latest portfolio state
    const walletORStkWalletToken = portfolioAccountState['1']?.result?.tokens.find(
      ({ address }) => address === STK_WALLET || address === WALLET_TOKEN
    )

    // Try catch this just in case the relayer sends unexpected data
    try {
      if (portfolioAccountState.projectedRewards) {
        const walletOrStkWalletTokenPrice = walletORStkWalletToken?.priceIn?.[0]?.price

        const projectedRewardsData = getProjectedRewardsStatsAndToken(
          portfolioAccountState.projectedRewards,
          walletOrStkWalletTokenPrice
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
        console.error(error)
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
      this.#portfolioErrors = []
      if (!skipUpdate) {
        this.emitUpdate()
      }
      return
    }

    this.#defiPositionsErrors = getNetworksWithDeFiPositionsErrorErrors({
      networks: this.#networks.networks,
      portfolioState: this.portfolio.portfolioState,
      providers: this.#providers.providers,
      networksWithPositions: [] as any
      // @TODO: Get from the portfolio
      // networksWithPositions: this.#defiPositions.getNetworksWithPositions(this.account.addr)
    })
    this.#portfolioErrors = getNetworksWithErrors({
      networks: this.#networks.networks,
      shouldShowPartialResult: this.portfolio.shouldShowPartialResult,
      selectedAccountPortfolioState: this.portfolio.portfolioState,
      isAllReady: this.portfolio.isAllReady,
      accountState: this.#accounts.accountStates[this.account.addr] || {},
      providers: this.#providers.providers,
      networksWithAssets: this.#portfolio.getNetworksWithAssets(this.account.addr)
    })

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  get balanceAffectingErrors() {
    // Sort errors so that errors are shown before warnings
    const sorted = [...this.#portfolioErrors, ...this.#defiPositionsErrors].sort((a, b) => {
      const order = { error: 0, warning: 1 } as const
      return order[a.type] - order[b.type]
    })

    return sorted
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
        this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId].includes(
          `${this.account!.addr}-${chainId}`
        )
      )
        return
      this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId].push(
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
      !this.#networks.isInitialized ||
      !this.portfolio.isAllReady
    )
      return []

    // @TODO: Read from the portfolio's defi positions state when available
    return []
    // const defiPositionsAccountState = this.#defiPositions.getDefiPositionsStateForAllNetworks(
    //   this.account.addr
    // )

    // const notDismissedNetworks = this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId]
    //   ? this.#networks.allNetworks.filter(
    //       (n) =>
    //         !this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId].includes(
    //           `${this.account!.addr}-${n.chainId}`
    //         )
    //     )
    //   : this.#networks.allNetworks
    // return getDefiPositionsOnDisabledNetworksForTheSelectedAccount({
    //   defiPositionsAccountState,
    //   networks: notDismissedNetworks,
    //   accountAddr: this.account.addr
    // })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      banners: this.banners,
      deprecatedSmartAccountBanner: this.deprecatedSmartAccountBanner,
      balanceAffectingErrors: this.balanceAffectingErrors,
      autoLoginPolicies: this.autoLoginPolicies
    }
  }
}
