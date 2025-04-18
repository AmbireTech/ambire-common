import { Account } from '../../interfaces/account'
import { AccountOpAction, Action as ActionFromActionsQueue } from '../../interfaces/actions'
// eslint-disable-next-line import/no-cycle
import { Action, Banner } from '../../interfaces/banner'
import { Network } from '../../interfaces/network'
import { CashbackStatusByAccount } from '../../interfaces/selectedAccount'
import { SwapAndBridgeActiveRoute } from '../../interfaces/swapAndBridge'
import { getIsBridgeTxn } from '../swapAndBridge/swapAndBridge'

const getBridgeActionText = (
  routeStatus: SwapAndBridgeActiveRoute['routeStatus'],
  isBridgeTxn: boolean
) => {
  if (isBridgeTxn) {
    return routeStatus === 'completed' ? 'Bridged' : 'Bridge'
  }

  return routeStatus === 'completed' ? 'Swapped' : 'Swap'
}

const getBridgeBannerText = (
  route: SwapAndBridgeActiveRoute,
  isBridgeTxn: boolean,
  networks?: Network[]
) => {
  const steps = route.route?.steps || []
  if (!steps[0]) return '' // should never happen

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

  return `${actionText} ${assetsText}`
}

export const getBridgeBanners = (
  activeRoutes: SwapAndBridgeActiveRoute[],
  accountOpActions: AccountOpAction[]
): Banner[] => {
  const isBridgeTxn = (route: SwapAndBridgeActiveRoute) =>
    !!route.route?.userTxs.some((t) => getIsBridgeTxn(t.userTxType))
  const isRouteTurnedIntoAccountOp = (route: SwapAndBridgeActiveRoute) => {
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
    if (route.routeStatus !== 'ready') return true
    return !isRouteTurnedIntoAccountOp(route)
  })

  const inProgressRoutes = filteredRoutes.filter((r) => r.routeStatus === 'in-progress')
  const failedRoutes = filteredRoutes.filter((r) => r.routeStatus === 'failed')
  const inProgressOrFailed = [...inProgressRoutes, ...failedRoutes]

  const completedRoutes = filteredRoutes.filter((r) => r.routeStatus === 'completed')

  const banners: Banner[] = []

  // Handle in-progress transactions grouping
  if (inProgressOrFailed.length > 0) {
    banners.push({
      id: 'bridge-in-progress',
      type: inProgressRoutes.length > 0 ? 'info' : 'error',
      category: 'bridge-in-progress',
      title: `${
        inProgressRoutes.length > 0
          ? `Bridge request${inProgressRoutes.length > 1 ? 's' : ''} in progress`
          : `Bridge request${failedRoutes.length > 1 ? 's' : ''} failed`
      }`,
      text:
        inProgressRoutes.length > 0
          ? `You have ${inProgressOrFailed.length} pending bridge${
              inProgressOrFailed.length > 1 ? 's' : ''
            }`
          : `You have ${failedRoutes.length} failed bridge${failedRoutes.length > 1 ? 's' : ''}`,
      actions: [
        {
          label: 'Close',
          actionName: 'close-bridge',
          meta: {
            activeRouteIds: inProgressOrFailed.map((r) => r.activeRouteId),
            isHideStyle: true
          }
        },
        {
          label: 'View',
          actionName: 'view-bridge'
        }
      ]
    })
  }

  // Handle completed transactions grouping
  if (inProgressOrFailed.length === 0 && completedRoutes.length > 0) {
    banners.push({
      id: 'bridge-completed',
      type: 'success',
      category: 'bridge-completed',
      title: `Bridge request${completedRoutes.length > 1 ? 's' : ''} completed`,
      text: `You have ${completedRoutes.length} completed bridge request${
        completedRoutes.length > 1 ? 's' : ''
      }.`,
      actions: [
        {
          label: 'Close',
          actionName: 'close-bridge',
          meta: { activeRouteIds: filteredRoutes.map((r) => r.activeRouteId), isHideStyle: true }
        }
      ]
    })
  }

  return banners
}

export const getDappActionRequestsBanners = (actions: ActionFromActionsQueue[]): Banner[] => {
  const requests = actions.filter((a) => !['accountOp', 'benzin', 'swapAndBridge'].includes(a.type))
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
  activeSwapAndBridgeRoutesForSelectedAccount: SwapAndBridgeActiveRoute[],
  chainId: bigint,
  nonSwapAndBridgeTxns: number,
  networks: Network[]
) => {
  const swapsAndBridges: string[] = []
  const networkSwapAndBridgeRoutes = activeSwapAndBridgeRoutesForSelectedAccount.filter((route) => {
    return route.route && BigInt(route.route.fromChainId) === chainId
  })

  if (networkSwapAndBridgeRoutes.length) {
    networkSwapAndBridgeRoutes.forEach((route) => {
      const isBridgeTxn = !!route.route?.userTxs.some((t) => getIsBridgeTxn(t.userTxType))
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
  swapAndBridgeRoutesPendingSignature: SwapAndBridgeActiveRoute[]
}): Banner[] => {
  if (!accountOpActionsByNetwork) return []
  const txnBanners: Banner[] = []

  const account = accounts.find((acc) => acc.addr === selectedAccount)

  if (account?.creation) {
    Object.entries(accountOpActionsByNetwork).forEach(([netId, actions]) => {
      actions.forEach((action) => {
        const network = networks.filter((n) => n.chainId.toString() === netId)[0]
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
      const network = networks.filter((n) => n.chainId.toString() === netId)[0]
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

  const shouldShowBanner = cashbackStatusByAccount[selectedAccountAddr] === 'unseen-cashback'

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
