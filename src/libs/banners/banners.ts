import { Account } from '../../interfaces/account'
import { AccountOpAction, Action as ActionFromActionsQueue } from '../../interfaces/actions'
// eslint-disable-next-line import/no-cycle
import { Action, Banner } from '../../interfaces/banner'
import { Network } from '../../interfaces/network'
import { ActiveRoute } from '../../interfaces/swapAndBridge'
import { CashbackStatusByAccount } from '../portfolio/interfaces'
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
      return action.accountOp.calls.some(
        (call) =>
          call.fromUserRequestId === route.activeRouteId ||
          call.fromUserRequestId === `${route.activeRouteId}-revoke-approval` ||
          call.fromUserRequestId === `${route.activeRouteId}-approval`
      )
    })
  }

  const filteredRoutes = activeRoutes.filter(isBridgeTxn).filter((route) => {
    if (route.routeStatus === 'failed') return false
    if (route.routeStatus !== 'ready') return true
    return !isRouteTurnedIntoAccountOp(route)
  })

  const inProgressRoutes = filteredRoutes.filter(
    (r) => r.routeStatus === 'in-progress' || r.routeStatus === 'waiting-approval-to-resolve'
  )

  const completedRoutes = filteredRoutes.filter((r) => r.routeStatus === 'completed')

  const remainingRoutes = filteredRoutes.filter(
    (r) => r.routeStatus !== 'in-progress' && r.routeStatus !== 'completed'
  )

  const banners: Banner[] = []

  // Handle in-progress transactions grouping
  if (inProgressRoutes.length > 0) {
    banners.push({
      id: 'bridge-in-progress',
      type: 'info',
      category: 'bridge-in-progress',
      title: 'Bridge request in progress',
      text: `You have ${inProgressRoutes.length} bridge request${
        inProgressRoutes.length > 1 ? 's' : ''
      } in progress.`,
      actions: [
        {
          label: 'Details',
          actionName: 'open-swap-and-bridge-tab'
        }
      ]
    })
  }

  // Handle completed transactions grouping
  if (completedRoutes.length > 0) {
    banners.push({
      id: 'bridge-completed',
      type: 'success',
      category: 'bridge-completed',
      title: 'Bridge request completed',
      text: `You have ${completedRoutes.length} completed bridge request${
        completedRoutes.length > 1 ? 's' : ''
      }.`,
      actions: [
        {
          label: 'Close',
          actionName: 'close-bridge',
          meta: { activeRouteId: completedRoutes[0].activeRouteId }
        }
      ]
    })
  }

  // Add other statuses normally
  banners.push(
    ...remainingRoutes.map((r) => ({
      id: `bridge-${r.activeRouteId}`,
      type: r.routeStatus === 'completed' ? 'success' : 'info',
      category: `bridge-${r.routeStatus}`,
      title: getBridgeBannerTitle(r.routeStatus),
      text: getBridgeBannerText(r, isBridgeTxn(r), networks),
      actions:
        r.routeStatus === 'ready'
          ? [
              {
                label: 'Reject',
                actionName: 'reject-bridge',
                meta: { activeRouteId: r.activeRouteId }
              },
              {
                label: r.route.currentUserTxIndex >= 1 ? 'Proceed to Next Step' : 'Open',
                actionName: 'proceed-bridge',
                meta: { activeRouteId: r.activeRouteId }
              }
            ]
          : []
    }))
  )

  return banners
}

export const getDappActionRequestsBanners = (actions: ActionFromActionsQueue[]): Banner[] => {
  const requests = actions.filter((a) => !['accountOp', 'benzin'].includes(a.type))
  if (!requests.length) return []

  return [
    {
      id: 'dapp-requests-banner',
      type: 'info',
      title: `You have ${requests.length} pending app request${requests.length > 1 ? 's' : ''}`,
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

export const getFirstCashbackBanners = ({
  selectedAccountAddr,
  cashbackStatusByAccount
}: {
  selectedAccountAddr: string
  cashbackStatusByAccount: CashbackStatusByAccount
}): Banner[] => {
  const banners: Banner[] = []

  const shouldShowBanner =
    !!cashbackStatusByAccount[selectedAccountAddr]?.firstCashbackReceivedAt &&
    !cashbackStatusByAccount[selectedAccountAddr]?.firstCashbackSeenAt

  if (shouldShowBanner) {
    banners.push({
      id: `${selectedAccountAddr}-first-cashback-banner-banner`,
      type: 'info',
      title: "You've got cashback!",
      text: 'You just received your first cashback from paying gas with Smart Account.',
      actions: [
        {
          label: 'Open',
          actionName: 'open-first-cashback-modal'
        }
      ]
    })
  }

  return banners
}
