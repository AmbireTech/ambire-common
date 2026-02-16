import { Account, AccountId } from '../../interfaces/account'
import { Banner, BannerType } from '../../interfaces/banner'
import { Network } from '../../interfaces/network'
import { SwapAndBridgeActiveRoute } from '../../interfaces/swapAndBridge'
import { CallsUserRequest, UserRequest } from '../../interfaces/userRequest'
import { PositionCountOnDisabledNetworks } from '../defiPositions/types'
import { HumanizerVisualization } from '../humanizer/interfaces'
import { getSameNonceRequests } from '../safe/safe'
import { getIsBridgeRoute } from '../swapAndBridge/swapAndBridge'

export const getCurrentAccountBanners = (banners: Banner[], selectedAccount?: AccountId) =>
  banners.filter((banner) => {
    if (!banner.meta?.accountAddr) return true

    return banner.meta.accountAddr === selectedAccount
  })

export const getBridgeBanners = (
  activeRoutes: SwapAndBridgeActiveRoute[],
  callsUserRequests: CallsUserRequest[]
): Banner[] => {
  const isRouteTurnedIntoAccountOp = (route: SwapAndBridgeActiveRoute) => {
    return callsUserRequests.some((req) => {
      return req.signAccountOp.accountOp.calls.some(
        (call) =>
          call.id === route.activeRouteId ||
          call.id === `${route.activeRouteId}-revoke-approval` ||
          call.id === `${route.activeRouteId}-approval`
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
          actionName: 'view-bridge'
        }
      ],
      dismissAction: {
        actionName: 'close-bridge',
        meta: {
          activeRouteIds: allRoutes.map((r) => r.activeRouteId),
          isHideStyle: true
        }
      }
    })
  }

  return banners
}

export const getSafeMessageRequestBanners = (
  account: Account,
  userRequests: UserRequest[]
): Banner[] => {
  if (!account.safeCreation) return []

  const requests = userRequests.filter((r) => ['message', 'typedMessage', 'siwe'].includes(r.kind))
  if (!requests.length) return []

  return [
    {
      id: 'safe-message-request-banner',
      type: 'info',
      title: `You have ${requests.length} pending signature request${requests.length > 1 ? 's' : ''}`,
      text: '',
      actions: [
        {
          actionName: 'open-pending-dapp-requests'
        }
      ]
    }
  ]
}

export const getDappUserRequestsBanners = (
  account: Account,
  userRequests: UserRequest[]
): Banner[] => {
  if (!!account.safeCreation) return []

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
          actionName: 'open-pending-dapp-requests'
        }
      ]
    }
  ]
}

const getSafeBanner = ({
  requests,
  network,
  selectedAccount
}: {
  requests: CallsUserRequest[]
  network: Network
  selectedAccount: Account
}): Banner => {
  return {
    id: `${selectedAccount.addr}-${network.chainId.toString()}`,
    type: 'info',
    category: 'pending-to-be-signed-acc-op',
    title: `Pending transactions ${network.name ? `on ${network.name}` : ''}`,
    text: `${requests.length} transactions are mutually exclusive (Same nonce).\nYou can sign only one.`,
    actions: [
      {
        actionName: 'open-accountOp',
        meta: { requestId: requests[0]!.id }
      }
    ]
  }
}

export const getAccountOpBanners = ({
  callsUserRequestsByNetwork,
  selectedAccount,
  networks
}: {
  callsUserRequestsByNetwork: {
    [key: string]: CallsUserRequest[]
  }
  selectedAccount: Account
  networks: Network[]
}): Banner[] => {
  if (!callsUserRequestsByNetwork) return []

  const txnBanners: Banner[] = []

  Object.entries(callsUserRequestsByNetwork).forEach(([netId, requests]) => {
    let remainingRequests: CallsUserRequest[] = []
    if (!!selectedAccount.safeCreation && requests.length > 1) {
      const sameNonceRequests = getSameNonceRequests(requests)
      const network = networks.filter((n) => n.chainId.toString() === netId)[0]!
      Object.keys(sameNonceRequests).forEach((nonce) => {
        const grouped = sameNonceRequests[nonce]!
        if (grouped.length === 1) {
          remainingRequests = [...remainingRequests, ...grouped]
          return
        }
        txnBanners.push(getSafeBanner({ requests: grouped, network, selectedAccount }))
      })
    } else remainingRequests = requests

    remainingRequests.forEach((request) => {
      const network = networks.filter((n) => n.chainId.toString() === netId)[0]!
      const callCount = request.signAccountOp.accountOp.calls.length

      txnBanners.push({
        id: `${selectedAccount.addr}-${netId}`,
        type: 'info',
        category: 'pending-to-be-signed-acc-op',
        title: `${
          callCount === 1 ? 'Transaction' : `${callCount} Transactions`
        } waiting to be signed ${network.name ? `on \n${network.name}` : ''}`,
        text: '',
        actions: [
          {
            actionName: 'open-accountOp',
            meta: { requestId: request.id }
          }
        ],
        dismissAction: {
          actionName: 'reject-accountOp',
          meta: {
            err: 'User rejected the transaction request.',
            requestId: request.id,
            shouldOpenNextAction: false
          }
        }
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
        actionName: 'sync-keys',
        meta: { email, keys }
      }
    ]
  }
  return banner
}

export const defiPositionsOnDisabledNetworksBannerId = 'defi-positions-on-disabled-networks-banner'

export const getDefiPositionsOnDisabledNetworksForTheSelectedAccount = ({
  defiPositionsCountOnDisabledNetworks,
  networks,
  accountAddr
}: {
  defiPositionsCountOnDisabledNetworks: PositionCountOnDisabledNetworks[string]
  networks: Network[]
  accountAddr: string
}) => {
  const banners: Banner[] = []

  const disabledNetworks = networks.filter((n) => n.disabled)

  if (!disabledNetworks.length) return []

  const disabledNetworksWithDefiPos = new Set<Network>()

  let totalCount = 0

  Object.entries(defiPositionsCountOnDisabledNetworks).forEach(([chainId, count]) => {
    totalCount += count
    if (count > 0) {
      const network = disabledNetworks.find((n) => n.chainId.toString() === chainId)
      if (network) {
        disabledNetworksWithDefiPos.add(network)
      }
    }
  })

  if (!disabledNetworksWithDefiPos.size) return []

  const disabledNetworksWithDefiPosArray = [...disabledNetworksWithDefiPos]

  banners.push({
    id: defiPositionsOnDisabledNetworksBannerId,
    type: 'info',
    title: 'DeFi positions detected on disabled networks',
    text: `You have ${totalCount} active DeFi ${totalCount === 1 ? 'position' : 'positions'} on${
      disabledNetworksWithDefiPosArray.length > 1 ? ' the following disabled networks' : ''
    }: ${disabledNetworksWithDefiPosArray
      .map((n) => n.name)
      .join(', ')}. Would you like to enable ${
      disabledNetworksWithDefiPosArray.length > 1 ? 'these networks' : 'this network'
    }?`,
    actions: [
      {
        actionName: 'enable-networks',
        meta: { networkChainIds: disabledNetworksWithDefiPosArray.map((n) => n.chainId) }
      }
    ],
    dismissAction: {
      actionName: 'dismiss-defi-positions-banner'
    },
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
