// eslint-disable-next-line import/no-cycle
import { PortfolioController } from '../../controllers/portfolio/portfolio'
import { Account, AccountId } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { RPCProviders } from '../../interfaces/settings'
import { UserRequest } from '../../interfaces/userRequest'
import { PORTFOLIO_LIB_ERROR_NAMES } from '../portfolio/portfolio'
import { getNetworksWithFailedRPC } from '../settings/settings'

export const getMessageBanners = ({ userRequests }: { userRequests: UserRequest[] }) => {
  const txnBanners: Banner[] = []

  if (!userRequests) return txnBanners

  userRequests.forEach((req: UserRequest) => {
    if (req.action.kind === 'message' || req.action.kind === 'typedMessage') {
      txnBanners.push({
        id: req.id,
        type: 'info',
        title: 'Message waiting to be signed',
        text: `Message type: ${req.action.kind === 'message' ? 'personal_sign' : 'typed_data'}`, // TODO:
        actions: [
          {
            label: 'Reject',
            actionName: 'reject',
            meta: { ids: [req.id], err: 'User rejected the transaction request' }
          },
          {
            label: 'Open',
            actionName: 'open',
            meta: { ids: [req.id] }
          }
        ]
      })
    }
  })

  return txnBanners
}

export const getAccountOpBannersForEOA = ({
  userRequests,
  accounts,
  networks
}: {
  userRequests: UserRequest[]
  accounts: Account[]
  networks: NetworkDescriptor[]
}): Banner[] => {
  if (!userRequests) return []

  const activeUserRequest = userRequests.find((req: UserRequest) => {
    const account = accounts.find((acc) => acc.addr === req.accountAddr) || ({} as Account)
    return req.action.kind === 'call' && !account?.creation
  })

  if (!activeUserRequest) return []

  const networkName = networks.filter((n) => n.id === activeUserRequest.networkId)[0].name

  return [
    {
      id: activeUserRequest.id,
      type: 'info',
      title: `Transaction waiting to be signed ${networkName ? `on ${networkName}` : ''}`,
      text: '', // TODO:
      actions: [
        {
          label: 'Reject',
          actionName: 'reject',
          meta: { ids: [activeUserRequest.id], err: 'User rejected the transaction request' }
        },
        {
          label: 'Open',
          actionName: 'open',
          meta: { ids: [activeUserRequest.id] }
        }
      ]
    } as Banner
  ]
}

export const getPendingAccountOpBannersForEOA = ({
  userRequests,
  accounts
}: {
  userRequests: UserRequest[]
  accounts: Account[]
}): Banner[] => {
  if (!userRequests) return []

  const pendingUserRequests: UserRequest[] = userRequests.filter((req: UserRequest) => {
    const account = accounts.find((acc) => acc.addr === req.accountAddr) || ({} as Account)
    return req.action.kind === 'call' && !account?.creation
  })

  const numberOfPendingRequest = pendingUserRequests.length - 1
  if (numberOfPendingRequest <= 0) return []

  return [
    {
      id: pendingUserRequests[0].id,
      type: 'info',
      title: `${numberOfPendingRequest} More pending transactions are waiting to be signed`,
      text: '' // TODO:
    } as Banner
  ]
}

export const getAccountOpBannersForSmartAccount = ({
  userRequests,
  accounts,
  networks
}: {
  userRequests: UserRequest[]
  accounts: Account[]
  networks: NetworkDescriptor[]
}) => {
  const txnBanners: Banner[] = []

  if (!userRequests) return txnBanners

  const groupedRequests = userRequests.reduce((acc: any, userRequest: UserRequest) => {
    const key = `${userRequest.accountAddr}-${userRequest.networkId}`

    if (!acc[key]) {
      acc[key] = []
    }
    const account = accounts.find((a) => a.addr === userRequest.accountAddr) || ({} as Account)
    if (userRequest.action.kind === 'call' && account.creation) {
      acc[key].push(userRequest)
    }

    return acc
  }, {})

  const groupedRequestsArray: UserRequest[][] = (
    (Object.values(groupedRequests || {}) || []) as UserRequest[][]
  ).filter((group: any) => group.length)

  groupedRequestsArray.forEach((group) => {
    const networkName = networks.filter((n) => n.id === group[0].networkId)[0].name

    txnBanners.push({
      id: group[0].id,
      type: 'info',
      title: `${group.length} ${
        group.length === 1 ? 'Transaction' : 'Transactions'
      } waiting to be signed ${networkName ? `on ${networkName}` : ''}`,
      text: '', // TODO:
      actions: [
        {
          label: 'Reject',
          actionName: 'reject',
          meta: { ids: group.map((g) => g.id), err: 'User rejected the transaction request' }
        },
        {
          label: 'Open',
          actionName: 'open',
          meta: { ids: [group[0].id] }
        }
      ]
    })
  })

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
  networks: NetworkDescriptor[]
  networksWithAssets: NetworkDescriptor['id'][]
}): Banner[] => {
  const banners: Banner[] = []
  const networkIds = getNetworksWithFailedRPC({ providers }).filter((networkId) =>
    networksWithAssets.includes(networkId)
  )

  const networksData = networkIds.map((id) => networks.find((n: NetworkDescriptor) => n.id === id)!)

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
      id: 'rpcs-down',
      type: 'warning',
      title: `Failed to retrieve network data for ${n.name}. You can try selecting another RPC URL`,
      text: 'Affected features: visible assets, sign message/transaction, ENS/UD domain resolving, add account.',
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
    type: 'warning',
    title: `Failed to retrieve network data for ${networksToGroupInSingleBanner
      .map((n) => n.name)
      .join(', ')} (RPC malfunction)`,
    text: 'Affected features: visible tokens, sign message/transaction, ENS/UD domain resolving, add account. Please try again later or contact support.',
    actions: []
  })

  return banners
}

export const getNetworksWithPortfolioErrorBanners = ({
  networks,
  portfolioLatest
}: {
  networks: NetworkDescriptor[]
  portfolioLatest: PortfolioController['latest']
}): Banner[] => {
  const banners: Banner[] = []

  const portfolioLoading = Object.keys(portfolioLatest).some((accId: AccountId) => {
    const accPortfolio = portfolioLatest[accId]

    return Object.keys(accPortfolio).some((network) => {
      const portfolioForNetwork = accPortfolio[network]

      return portfolioForNetwork?.isLoading
    })
  })

  // Otherwise networks are appended to the banner one by one, which looks weird
  if (portfolioLoading) return []

  Object.keys(portfolioLatest).forEach((accId: AccountId) => {
    const accPortfolio = portfolioLatest[accId]

    if (!accPortfolio) return

    const networkNamesWithPriceFetchError: string[] = []
    const networkNamesWithCriticalError: string[] = []

    Object.keys(accPortfolio).forEach((network) => {
      const portfolioForNetwork = accPortfolio[network]
      const criticalError = portfolioForNetwork?.criticalError

      const networkData = networks.find((n: NetworkDescriptor) => n.id === network)

      if (!portfolioForNetwork || !networkData || portfolioForNetwork.isLoading) return

      if (criticalError) {
        networkNamesWithCriticalError.push(networkData.name)
        // If there is a critical error, we don't need to check for price fetch error
        return
      }

      const priceFetchError = portfolioForNetwork?.errors.find(
        (err: any) => err?.name === PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError
      )

      if (priceFetchError) {
        networkNamesWithPriceFetchError.push(networkData.name)
      }
    })

    if (networkNamesWithPriceFetchError.length) {
      banners.push({
        accountAddr: accId,
        id: `${accId}-portfolio-prices-error`,
        type: 'warning',
        title: `Failed to retrieve prices for ${networkNamesWithPriceFetchError.join(', ')}`,
        text: 'Affected features: account balances, asset prices. Please try again later or contact support.',
        actions: []
      })
    }
    if (networkNamesWithCriticalError.length) {
      banners.push({
        accountAddr: accId,
        id: `${accId}-portfolio-critical-error`,
        type: 'error',
        title: `Failed to retrieve the portfolio data for ${networkNamesWithCriticalError.join(
          ', '
        )}`,
        text: 'Affected features: account balances, visible assets. Please try again later or contact support.',
        actions: []
      })
    }
  })

  return banners
}
