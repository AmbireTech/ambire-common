import { ShouldShowConfettiBanner } from 'libs/portfolio/interfaces'

import { Account } from '../../interfaces/account'
import { AccountOpAction, Action as ActionFromActionsQueue } from '../../interfaces/actions'
import { Action, Banner } from '../../interfaces/banner'
import { Network, NetworkId } from '../../interfaces/network'
import { RPCProviders } from '../../interfaces/provider'
import { ActiveRoute } from '../../interfaces/swapAndBridge'
import {
  AccountState as DefiPositionsAccountState,
  DeFiPositionsError
} from '../defiPositions/types'
import { getNetworksWithFailedRPC } from '../networks/networks'
import { AccountState as PortfolioAccountState } from '../portfolio/interfaces'
import { PORTFOLIO_LIB_ERROR_NAMES } from '../portfolio/portfolio'
import { getIsBridgeTxn, getQuoteRouteSteps } from '../swapAndBridge/swapAndBridge'

const getBridgeBannerTitle = (routeStatus: ActiveRoute['routeStatus']) => {
  switch (routeStatus) {
    case 'completed':
      return 'Bridge request completed'
    case 'in-progress':
      return 'Bridge request in progress'
    default:
      return 'Bridge request awaiting signature'
  }
}

const getBridgeActionText = (routeStatus: ActiveRoute['routeStatus'], isBridgeTxn: boolean) => {
  if (isBridgeTxn) {
    return routeStatus === 'completed' ? 'Bridged' : 'Bridge'
  }

  return routeStatus === 'completed' ? 'Swapped' : 'Swap'
}

const getBridgeBannerText = (route: ActiveRoute, isBridgeTxn: boolean, networks?: Network[]) => {
  const steps = getQuoteRouteSteps(route.route.userTxs)
  const actionText = getBridgeActionText(route.routeStatus, isBridgeTxn)
  const fromAssetSymbol = steps[0].fromAsset.symbol
  const toAssetSymbol = steps[steps.length - 1].toAsset.symbol

  let assetsText = `${fromAssetSymbol} to ${toAssetSymbol}`

  if (networks) {
    const fromAssetNetwork = networks.find((n) => Number(n.chainId) === steps[0].fromAsset.chainId)
    const toAssetNetwork = networks.find(
      (n) => Number(n.chainId) === steps[steps.length - 1].toAsset.chainId
    )
    if (fromAssetNetwork && toAssetNetwork) {
      assetsText = `${fromAssetSymbol} (on ${fromAssetNetwork.name}) to ${toAssetSymbol} (on ${toAssetNetwork.name})`
    }
  }

  const stepsIndexText = `(step ${
    route.routeStatus === 'completed' ? route.route.totalUserTx : route.route.currentUserTxIndex + 1
  } of ${route.route.totalUserTx})`

  return `${actionText} ${assetsText}${route.route.totalUserTx > 1 ? ` ${stepsIndexText}` : ''}`
}

export const getBridgeBanners = (
  activeRoutes: ActiveRoute[],
  accountOpActions: AccountOpAction[],
  networks: Network[]
): Banner[] => {
  const isBridgeTxn = (route: ActiveRoute) =>
    route.route.userTxs.some((t) => getIsBridgeTxn(t.userTxType))
  const isRouteTurnedIntoAccountOp = (route: ActiveRoute) => {
    return accountOpActions.some((action) => {
      return action.accountOp.calls.some((call) => call.fromUserRequestId === route.activeRouteId)
    })
  }

  return activeRoutes
    .filter(isBridgeTxn)
    .filter((route) => {
      if (route.routeStatus !== 'ready') return true

      // If the route is ready to be signed, we should display the banner only if it's not turned into an account op
      // because when it does get turned into an account op, there will be a different banner for that
      return !isRouteTurnedIntoAccountOp(route)
    })
    .map((r) => {
      const actions: Action[] = []

      if (r.routeStatus === 'in-progress') {
        actions.push({
          label: 'Details',
          actionName: 'open-swap-and-bridge-tab'
        })
      }

      if (r.routeStatus === 'completed') {
        actions.push({
          label: 'Close',
          actionName: 'close-bridge',
          meta: { activeRouteId: r.activeRouteId }
        })
      }

      if (r.routeStatus === 'ready') {
        const isNextTnxForBridging = r.route.currentUserTxIndex >= 1

        actions.push(
          {
            label: 'Reject',
            actionName: 'reject-bridge',
            meta: { activeRouteId: r.activeRouteId }
          },
          {
            label: isNextTnxForBridging ? 'Proceed to Next Step' : 'Open',
            actionName: 'proceed-bridge',
            meta: { activeRouteId: r.activeRouteId }
          }
        )
      }

      return {
        id: `bridge-${r.activeRouteId}`,
        type: r.routeStatus === 'completed' ? 'success' : 'info',
        category: `bridge-${r.routeStatus}`,
        title: getBridgeBannerTitle(r.routeStatus),
        text: getBridgeBannerText(r, true, networks),
        actions
      }
    })
}

export const getDappActionRequestsBanners = (actions: ActionFromActionsQueue[]): Banner[] => {
  const requests = actions.filter((a) => !['accountOp', 'benzin'].includes(a.type))
  if (!requests.length) return []

  return [
    {
      id: 'dapp-requests-banner',
      type: 'info',
      title: `You have ${requests.length} pending dApp request${requests.length > 1 ? 's' : ''}`,
      text: '',
      actions: [
        {
          label: 'Open',
          actionName: 'open-pending-dapp-requests'
        }
      ]
    }
  ]
}

const getAccountOpBannerText = (
  activeSwapAndBridgeRoutesForSelectedAccount: ActiveRoute[],
  chainId: bigint,
  nonSwapAndBridgeTxns: number,
  networks: Network[]
) => {
  const swapsAndBridges: string[] = []
  const networkSwapAndBridgeRoutes = activeSwapAndBridgeRoutesForSelectedAccount.filter((route) => {
    return BigInt(route.route.fromChainId) === chainId
  })

  if (networkSwapAndBridgeRoutes.length) {
    networkSwapAndBridgeRoutes.forEach((route) => {
      const isBridgeTxn = route.route.userTxs.some((t) => getIsBridgeTxn(t.userTxType))
      const desc = getBridgeBannerText(route, isBridgeTxn, networks)

      swapsAndBridges.push(desc)
    })

    return `${swapsAndBridges.join(', ')} ${
      nonSwapAndBridgeTxns
        ? `and ${nonSwapAndBridgeTxns} other transaction${nonSwapAndBridgeTxns > 1 ? 's' : ''}`
        : ''
    }`
  }

  return ''
}

export const getAccountOpBanners = ({
  accountOpActionsByNetwork,
  selectedAccount,
  accounts,
  networks,
  swapAndBridgeRoutesPendingSignature
}: {
  accountOpActionsByNetwork: {
    [key: string]: AccountOpAction[]
  }

  selectedAccount: string
  accounts: Account[]
  networks: Network[]
  swapAndBridgeRoutesPendingSignature: ActiveRoute[]
}): Banner[] => {
  if (!accountOpActionsByNetwork) return []
  const txnBanners: Banner[] = []

  const account = accounts.find((acc) => acc.addr === selectedAccount)

  if (account?.creation) {
    Object.entries(accountOpActionsByNetwork).forEach(([netId, actions]) => {
      actions.forEach((action) => {
        const network = networks.filter((n) => n.id === netId)[0]
        const nonSwapAndBridgeTxns = action.accountOp.calls.reduce((prev, call) => {
          const isSwapAndBridge = swapAndBridgeRoutesPendingSignature.some(
            (route) => route.activeRouteId === call.fromUserRequestId
          )

          if (isSwapAndBridge) return prev

          return prev + 1
        }, 0)
        const text = getAccountOpBannerText(
          swapAndBridgeRoutesPendingSignature,
          BigInt(network.chainId),
          nonSwapAndBridgeTxns,
          networks
        )

        txnBanners.push({
          id: `${selectedAccount}-${netId}`,
          type: 'info',
          category: 'pending-to-be-signed-acc-op',
          title: `Transaction waiting to be signed ${network.name ? `on ${network.name}` : ''}`,
          text,
          actions: [
            {
              label: 'Reject',
              actionName: 'reject-accountOp',
              meta: {
                err: 'User rejected the transaction request.',
                actionId: action.id,
                shouldOpenNextAction: false
              }
            },
            {
              label: 'Open',
              actionName: 'open-accountOp',
              meta: { actionId: action.id }
            }
          ]
        })
      })
    })
  } else {
    Object.entries(accountOpActionsByNetwork).forEach(([netId, actions]) => {
      const network = networks.filter((n) => n.id === netId)[0]
      const nonSwapAndBridgeTxns = actions.reduce((prev, action) => {
        action.accountOp.calls.forEach((call) => {
          const isSwapAndBridge = swapAndBridgeRoutesPendingSignature.some(
            (route) => route.activeRouteId === call.fromUserRequestId
          )

          if (isSwapAndBridge) return prev

          return prev + 1
        })

        return prev
      }, 0)

      const text = getAccountOpBannerText(
        swapAndBridgeRoutesPendingSignature,
        BigInt(network.chainId),
        nonSwapAndBridgeTxns,
        networks
      )

      txnBanners.push({
        id: `${selectedAccount}-${netId}`,
        type: 'info',
        title: `${actions.length} transaction${
          actions.length > 1 ? 's' : ''
        } waiting to be signed ${network.name ? `on ${network.name}` : ''}`,
        text,
        actions: [
          actions.length <= 1
            ? {
                label: 'Reject',
                actionName: 'reject-accountOp',
                meta: {
                  err: 'User rejected the transaction request.',
                  actionId: actions[0].id
                }
              }
            : undefined,
          {
            label: 'Open',
            actionName: 'open-accountOp',
            meta: {
              actionId: actions[0].id
            }
          }
        ].filter(Boolean) as Action[]
      })
    })
  }

  return txnBanners
}

export const getKeySyncBanner = (addr: string, email: string, keys: string[]) => {
  const banner: Banner = {
    id: `keys-sync:${addr}:${email}`,
    accountAddr: addr,
    type: 'info',
    title: 'Sync Key Store keys',
    text: 'This account has no signing keys added therefore it is in a view-only mode. Make a request for keys sync from another device.',
    actions: [
      {
        label: 'Sync',
        actionName: 'sync-keys',
        meta: { email, keys }
      }
    ]
  }
  return banner
}

export const getNetworksWithFailedRPCBanners = ({
  providers,
  networks,
  networksWithAssets
}: {
  providers: RPCProviders
  networks: Network[]
  networksWithAssets: NetworkId[]
}): Banner[] => {
  const banners: Banner[] = []
  const networkIds = getNetworksWithFailedRPC({ providers }).filter((networkId) =>
    networksWithAssets.includes(networkId)
  )

  const networksData = networkIds.map((id) => networks.find((n: Network) => n.id === id)!)

  const allFailed = networksData.length === networks.length

  const networksWithMultipleRpcUrls = allFailed
    ? []
    : networksData.filter((n) => n?.rpcUrls?.length > 1)

  const networksToGroupInSingleBanner = allFailed
    ? networksData
    : networksData.filter((n) => n?.rpcUrls?.length <= 1)

  if (!networksData.length) return banners

  networksWithMultipleRpcUrls.forEach((n) => {
    banners.push({
      id: `${n.id}-custom-rpcs-down`,
      type: 'error',
      title: `Failed to retrieve network data for ${n.name}. You can try selecting another RPC URL`,
      text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS/UD domain resolving, add account.',
      actions: [
        {
          label: 'Select',
          actionName: 'select-rpc-url',
          meta: {
            network: n
          }
        }
      ]
    })
  })

  if (!networksToGroupInSingleBanner.length) return banners

  banners.push({
    id: 'rpcs-down',
    type: 'error',
    title: `Failed to retrieve network data for ${networksToGroupInSingleBanner
      .map((n) => n.name)
      .join(', ')} (RPC malfunction)`,
    text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS/UD domain resolving, add account. Please try again later or contact support.',
    actions: []
  })

  return banners
}

export const getNetworksWithPortfolioErrorBanners = ({
  networks,
  selectedAccountLatest,
  providers
}: {
  networks: Network[]
  selectedAccountLatest: PortfolioAccountState
  providers: RPCProviders
}): Banner[] => {
  const banners: Banner[] = []

  const portfolioLoading = Object.keys(selectedAccountLatest).some((network) => {
    const portfolioForNetwork = selectedAccountLatest[network]

    return portfolioForNetwork?.isLoading
  })

  // Otherwise networks are appended to the banner one by one, which looks weird
  if (portfolioLoading) return []

  const networkNamesWithCriticalError: string[] = []
  const networkNamesWithPriceFetchError: string[] = []

  if (!Object.keys(selectedAccountLatest).length) return []

  Object.keys(selectedAccountLatest).forEach((network) => {
    const portfolioForNetwork = selectedAccountLatest[network]
    const criticalError = portfolioForNetwork?.criticalError

    let networkName: string | null = null

    if (network === 'gasTank') networkName = 'Gas Tank'
    else if (network === 'rewards') networkName = 'Rewards'
    else networkName = networks.find((n) => n.id === network)?.name ?? null

    if (!portfolioForNetwork || !networkName || portfolioForNetwork.isLoading) return

    // Don't display an error banner if the RPC isn't working because an RPC error banner is already displayed.
    // In case of additional networks don't check the RPC as there isn't one
    if (
      criticalError &&
      (['gasTank', 'rewards'].includes(network) || providers[network].isWorking)
    ) {
      networkNamesWithCriticalError.push(networkName as string)
      // If there is a critical error, we don't need to check for price fetch error
      return
    }

    portfolioForNetwork?.errors.forEach((err: any) => {
      if (err?.name === PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError) {
        networkNamesWithPriceFetchError.push(networkName as string)
      } else if (err?.name === PORTFOLIO_LIB_ERROR_NAMES.HintsError) {
        networkNamesWithCriticalError.push(networkName as string)
      }
    })
  })

  if (networkNamesWithPriceFetchError.length) {
    banners.push({
      id: 'portfolio-prices-error',
      type: 'warning',
      title: `Failed to retrieve prices for ${networkNamesWithPriceFetchError.join(', ')}`,
      text: 'Affected features: account balances, asset prices. Reload the account or try again later.',
      actions: []
    })
  }
  if (networkNamesWithCriticalError.length) {
    banners.push({
      id: 'portfolio-critical-error',
      type: 'error',
      title: `Failed to retrieve the portfolio data for ${networkNamesWithCriticalError.join(
        ', '
      )}`,
      text: 'Affected features: account balances, visible assets. Reload the account or try again later.',
      actions: []
    })
  }

  return banners
}

export const getNetworksWithDeFiPositionsErrorBanners = ({
  networks,
  currentAccountState,
  providers
}: {
  networks: Network[]
  currentAccountState: DefiPositionsAccountState
  providers: RPCProviders
}) => {
  const isLoading = Object.keys(currentAccountState).some((networkId) => {
    const networkState = currentAccountState[networkId]
    return networkState.isLoading
  })

  if (isLoading) return []

  const networkNamesWithUnknownCriticalError: string[] = []
  const networkNamesWithAssetPriceCriticalError: string[] = []
  const providersWithErrors: {
    [providerName: string]: string[]
  } = {}

  Object.keys(currentAccountState).forEach((networkId) => {
    const networkState = currentAccountState[networkId]
    const network = networks.find((n) => n.id === networkId)
    const rpcProvider = providers[networkId]

    if (
      !network ||
      !networkState ||
      // Don't display an error banner if the RPC isn't working because an RPC error banner is already displayed.
      (typeof rpcProvider.isWorking === 'boolean' && !rpcProvider.isWorking)
    )
      return

    if (networkState.error) {
      if (networkState.error === DeFiPositionsError.AssetPriceError) {
        networkNamesWithAssetPriceCriticalError.push(network.name)
      } else if (networkState.error === DeFiPositionsError.CriticalError) {
        networkNamesWithUnknownCriticalError.push(network.name)
      }
    }

    const providerNamesWithErrors = networkState.providerErrors?.map((e) => e.providerName) || []

    if (providerNamesWithErrors.length) {
      providerNamesWithErrors.forEach((providerName) => {
        if (!providersWithErrors[providerName]) providersWithErrors[providerName] = []

        providersWithErrors[providerName].push(network.name)
      })
    }
  })

  const providerErrorBanners: Banner[] = Object.entries(providersWithErrors).map(
    ([providerName, networkNames]) => {
      return {
        id: `${providerName}-defi-positions-error`,
        type: 'error',
        title: `Failed to retrieve DeFi positions for ${providerName} on ${networkNames.join(
          ', '
        )}`,
        text: 'Reload the account or try again later.',
        actions: []
      }
    }
  )

  const banners = providerErrorBanners

  if (networkNamesWithUnknownCriticalError.length) {
    banners.push({
      id: 'defi-positions-critical-error',
      type: 'error',
      title: `Failed to retrieve DeFi positions on ${networkNamesWithUnknownCriticalError.join(
        ', '
      )}`,
      text: 'Reload the account or try again later.',
      actions: []
    })
  }
  if (networkNamesWithAssetPriceCriticalError.length) {
    banners.push({
      id: 'defi-positions-asset-price-error',
      type: 'warning',
      title: `Failed to retrieve asset prices for DeFi positions on ${networkNamesWithAssetPriceCriticalError.join(
        ', '
      )}`,
      text: 'Reload the account or try again later.',
      actions: []
    })
  }

  return banners
}

export const getFirstCashbackBanners = ({
  selectedAccountAddr,
  shouldShowConfetti
}: {
  selectedAccountAddr: string
  shouldShowConfetti: ShouldShowConfettiBanner
}): Banner[] => {
  let banners: Banner[] = []

  const shouldShowConfettiBanner = shouldShowConfetti[selectedAccountAddr]

  if (shouldShowConfettiBanner) {
    // TODO: Fix the texts
    banners.push({
      id: `${selectedAccountAddr}-first-cashback-banner-banner`,
      type: 'info',
      title: 'Cashback',
      text: "You've received your first cashback",
      actions: [
        {
          label: 'Open',
          actionName: 'open-confetti-modal'
        }
      ]
    })
  }

  return banners
}
