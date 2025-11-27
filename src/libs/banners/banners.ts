import { AccountId } from '../../interfaces/account'
import { Banner, BannerType } from '../../interfaces/banner'
import { Network } from '../../interfaces/network'
import { SwapAndBridgeActiveRoute } from '../../interfaces/swapAndBridge'
import { CallsUserRequest, UserRequest } from '../../interfaces/userRequest'
import { AccountState } from '../defiPositions/types'
import { HumanizerVisualization } from '../humanizer/interfaces'
import { getIsBridgeRoute } from '../swapAndBridge/swapAndBridge'

export const getCurrentAccountBanners = (banners: Banner[], selectedAccount?: AccountId) =>
  banners.filter((banner) => {
    if (!banner.meta?.accountAddr) return true

    return banner.meta.accountAddr === selectedAccount
  })

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
  callsUserRequests: CallsUserRequest[]
): Banner[] => {
  const isRouteTurnedIntoAccountOp = (route: SwapAndBridgeActiveRoute) => {
    return callsUserRequests.some((req) => {
      return req.accountOp.calls.some(
        (call) =>
          call.fromUserRequestId === route.activeRouteId ||
          call.fromUserRequestId === `${route.activeRouteId}-revoke-approval` ||
          call.fromUserRequestId === `${route.activeRouteId}-approval`
      )
    })
  }

  const filteredRoutes = activeRoutes.filter((route) => {
    if (!route.route || !getIsBridgeRoute(route.route)) return false
    if (route.routeStatus !== 'ready' && route.routeStatus !== 'waiting-approval-to-resolve')
      return true
    return !isRouteTurnedIntoAccountOp(route)
  })

  const inProgressRoutes = filteredRoutes.filter((r) => r.routeStatus === 'in-progress')
  const failedRoutes = filteredRoutes.filter((r) => r.routeStatus === 'failed')
  const completedRoutes = filteredRoutes.filter((r) => r.routeStatus === 'completed')
  const refundedRoutes = filteredRoutes.filter((r) => r.routeStatus === 'refunded')
  const allRoutes = [...inProgressRoutes, ...failedRoutes, ...completedRoutes, ...refundedRoutes]

  let title = ''
  let text = ''
  let type: BannerType
  if (inProgressRoutes.length > 0) {
    type = 'info'
    title = `Bridge${inProgressRoutes.length > 1 ? 's' : ''} in progress`
    text = `You have ${inProgressRoutes.length} pending bridge${
      inProgressRoutes.length > 1 ? 's' : ''
    }`
  } else if (failedRoutes.length > 0) {
    type = 'error'
    title = `Failed bridge${failedRoutes.length > 1 ? 's' : ''}`
    text = `You have ${failedRoutes.length} failed bridge${failedRoutes.length > 1 ? 's' : ''}${
      completedRoutes.length > 1
        ? ` and ${completedRoutes.length} completed bridge${completedRoutes.length > 1 ? 's' : ''}`
        : ''
    }${
      refundedRoutes.length > 1
        ? ` and ${refundedRoutes.length} refunded bridge${refundedRoutes.length > 1 ? 's' : ''}`
        : ''
    }`
  } else if (refundedRoutes.length > 0) {
    type = 'warning'
    title = `Refunded bridge${refundedRoutes.length > 1 ? 's' : ''}`
    text = `You have ${refundedRoutes.length} refunded bridge${
      refundedRoutes.length > 1 ? 's' : ''
    }${
      completedRoutes.length > 1
        ? ` and ${completedRoutes.length} completed bridge${completedRoutes.length > 1 ? 's' : ''}`
        : ''
    }`
  } else {
    type = 'success'
    title = `Bridge${completedRoutes.length > 1 ? 's' : ''} completed`
    text = `You have ${completedRoutes.length} completed bridge${
      completedRoutes.length > 1 ? 's' : ''
    }.`
  }

  const banners: Banner[] = []
  if (allRoutes.length > 0) {
    banners.push({
      id: 'bridge-in-progress',
      type,
      category: 'bridge-in-progress',
      title,
      text,
      actions: [
        {
          label: 'Close',
          actionName: 'close-bridge',
          meta: {
            activeRouteIds: allRoutes.map((r) => r.activeRouteId),
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

  return banners
}

export const getDappUserRequestsBanners = (userRequests: UserRequest[]): Banner[] => {
  const requests = userRequests.filter(
    (r) => !['calls', 'benzin', 'swapAndBridge', 'transfer'].includes(r.kind)
  )
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
      const isBridgeTxn = !!route.route?.steps.some(
        (s) => s.fromAsset.chainId !== s.toAsset.chainId
      )
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
  callsUserRequestsByNetwork,
  selectedAccount,
  networks,
  swapAndBridgeRoutesPendingSignature
}: {
  callsUserRequestsByNetwork: {
    [key: string]: CallsUserRequest[]
  }

  selectedAccount: string
  networks: Network[]
  swapAndBridgeRoutesPendingSignature: SwapAndBridgeActiveRoute[]
}): Banner[] => {
  if (!callsUserRequestsByNetwork) return []
  const txnBanners: Banner[] = []

  Object.entries(callsUserRequestsByNetwork).forEach(([netId, actions]) => {
    actions.forEach((action) => {
      const network = networks.filter((n) => n.chainId.toString() === netId)[0]
      const nonSwapAndBridgeTxns = action.accountOp.calls.reduce((prev, call) => {
        const isSwapAndBridge = swapAndBridgeRoutesPendingSignature.some(
          (route) => route.activeRouteId === call.fromUserRequestId
        )

        if (isSwapAndBridge) return prev

        return prev + 1
      }, 0)
      const callCount = action.accountOp.calls.length
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
        title: `${
          callCount === 1 ? 'Transaction' : `${callCount} Transactions`
        } waiting to be signed ${network.name ? `on ${network.name}` : ''}`,
        text,
        actions: [
          {
            label: 'Reject',
            actionName: 'reject-accountOp',
            meta: {
              err: 'User rejected the transaction request.',
              requestId: action.id,
              shouldOpenNextAction: false
            }
          },
          {
            label: 'Open',
            actionName: 'open-accountOp',
            meta: { requestId: action.id }
          }
        ]
      })
    })
  })

  return txnBanners
}

export const getKeySyncBanner = (addr: string, email: string, keys: string[]) => {
  const banner: Banner = {
    id: `keys-sync:${addr}:${email}`,
    meta: {
      accountAddr: addr
    },
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

export const defiPositionsOnDisabledNetworksBannerId = 'defi-positions-on-disabled-networks-banner'

export const getDefiPositionsOnDisabledNetworksForTheSelectedAccount = ({
  defiPositionsAccountState,
  networks,
  accountAddr
}: {
  defiPositionsAccountState: AccountState
  networks: Network[]
  accountAddr: string
}) => {
  const banners: Banner[] = []

  const disabledNetworks = networks.filter((n) => n.disabled)

  if (!disabledNetworks.length) return []

  const defiPositionsOnDisabledNetworks = []
  const disabledNetworksWithDefiPos = new Set<Network>()

  disabledNetworks.forEach((n) => {
    if (defiPositionsAccountState[n.chainId.toString()]) {
      defiPositionsAccountState[n.chainId.toString()].positionsByProvider.forEach((p) => {
        defiPositionsOnDisabledNetworks.push(p)
        disabledNetworksWithDefiPos.add(n)
      })
    }
  })

  if (!defiPositionsOnDisabledNetworks.length) return []

  const disabledNetworksWithDefiPosArray = [...disabledNetworksWithDefiPos]

  banners.push({
    id: defiPositionsOnDisabledNetworksBannerId,
    type: 'info',
    title: 'DeFi positions detected on disabled networks',
    text: `You have ${defiPositionsOnDisabledNetworks.length} active DeFi ${
      defiPositionsOnDisabledNetworks.length === 1 ? 'position' : 'positions'
    } on${
      disabledNetworksWithDefiPosArray.length > 1 ? ' the following disabled networks' : ''
    }: ${disabledNetworksWithDefiPosArray
      .map((n) => n.name)
      .join(', ')}. Would you like to enable ${
      disabledNetworksWithDefiPosArray.length > 1 ? 'these networks' : 'this network'
    }?`,
    actions: [
      {
        label: disabledNetworksWithDefiPosArray.length > 1 ? 'Enable all' : 'Enable',
        actionName: 'enable-networks',
        meta: { networkChainIds: disabledNetworksWithDefiPosArray.map((n) => n.chainId) }
      },
      {
        label: 'Dismiss',
        actionName: 'dismiss-defi-positions-banner'
      }
    ],
    meta: {
      accountAddr
    }
  })

  return banners
}

export function getScamDetectedText(blacklistedItems: HumanizerVisualization[]) {
  const blacklistedItemsCount = blacklistedItems.length
  const hasScamAddress = blacklistedItems.some((i) => i.type === 'address')
  const hasScamToken = blacklistedItems.some((i) => i.type === 'token')

  const isSingle = blacklistedItemsCount === 1

  let label = ''

  if (hasScamAddress && hasScamToken) {
    label = blacklistedItemsCount === 2 ? 'address or token' : 'addresses or tokens'
  } else if (hasScamAddress) {
    label = isSingle ? 'address' : 'addresses'
  } else if (hasScamToken) {
    label = isSingle ? 'token' : 'tokens'
  }

  // eslint-disable-next-line no-nested-ternary
  const prefix = isSingle
    ? `The destination ${label}`
    : `${blacklistedItemsCount} of the destination ${label}`

  return `${prefix} in this transaction ${
    isSingle ? 'was' : 'were'
  } flagged as dangerous. Proceed at your own risk.`
}
