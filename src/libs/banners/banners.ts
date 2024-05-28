import { AccountOpAction, Action as ActionFromActionsQueue } from 'controllers/actions/actions'

// eslint-disable-next-line import/no-cycle
import { PortfolioController } from '../../controllers/portfolio/portfolio'
import { Account, AccountId } from '../../interfaces/account'
import { Action, Banner } from '../../interfaces/banner'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { RPCProviders } from '../../interfaces/settings'
import { PORTFOLIO_LIB_ERROR_NAMES } from '../portfolio/portfolio'
import { getNetworksWithFailedRPC } from '../settings/settings'

export const getDappActionRequestsBanners = (actions: ActionFromActionsQueue[]): Banner[] => {
  const requests = actions.filter((a) => a.type !== 'accountOp')
  if (!requests.length) return []

  return [
    {
      id: 'dapp-requests-banner',
      type: 'info',
      title: `You have ${requests.length} pending dApp requests`,
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

export const getAccountOpBanners = ({
  accountOpActionsByNetwork,
  selectedAccount,
  accounts,
  networks
}: {
  accountOpActionsByNetwork: {
    [key: string]: AccountOpAction[]
  }

  selectedAccount: string
  accounts: Account[]
  networks: NetworkDescriptor[]
}): Banner[] => {
  if (!accountOpActionsByNetwork) return []
  const txnBanners: Banner[] = []

  const account = accounts.find((acc) => acc.addr === selectedAccount)

  if (account?.creation) {
    Object.entries(accountOpActionsByNetwork).forEach(([netId, actions]) => {
      actions.forEach((action) => {
        const network = networks.filter((n) => n.id === netId)[0]

        txnBanners.push({
          id: `${selectedAccount}-${netId}`,
          type: 'info',
          title: `Transaction waiting to be signed ${network.name ? `on ${network.name}` : ''}`,
          text: '', // TODO:
          actions: [
            {
              label: 'Reject',
              actionName: 'reject-accountOp',
              meta: {
                err: 'User rejected the transaction request',
                actionId: action.id
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

      txnBanners.push({
        id: `${selectedAccount}-${netId}`,
        type: 'info',
        title: `${actions.length} transaction${
          actions.length > 1 ? 's' : ''
        } waiting to be signed ${network.name ? `on ${network.name}` : ''}`,
        text: '', // TODO:
        actions: [
          actions.length <= 1
            ? {
                label: 'Reject',
                actionName: 'reject-accountOp',
                meta: {
                  err: 'User rejected the transaction request',
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
