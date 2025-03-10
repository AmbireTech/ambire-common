import { Network, NetworkId } from '../../interfaces/network'
import { RPCProviders } from '../../interfaces/provider'
import { SelectedAccountPortfolioState } from '../../interfaces/selectedAccount'
import {
  AccountState as DefiPositionsAccountState,
  DeFiPositionsError,
  NetworksWithPositions
} from '../defiPositions/types'
import { getNetworksWithFailedRPC } from '../networks/networks'
import { PORTFOLIO_HINT_ERRORS } from '../portfolio/constants'
import { AccountAssetsState } from '../portfolio/interfaces'
import { PORTFOLIO_LIB_ERROR_NAMES } from '../portfolio/portfolio'

const TEN_MINUTES = 10 * 60 * 1000

export type Action = {
  label: 'Select'
  actionName: 'select-rpc-url'
  meta: { network: Network }
}

export type SelectedAccountBalanceError = {
  id:
    | `custom-rpcs-down-${NetworkId}`
    | 'rpcs-down'
    | 'portfolio-critical'
    | 'loading-too-long'
    | 'defi-critical'
    | 'defi-prices'
    | `${string}-defi-positions-error`
    | keyof typeof PORTFOLIO_LIB_ERROR_NAMES
    | keyof typeof PORTFOLIO_HINT_ERRORS
  networkNames: string[]
  type: 'error' | 'warning'
  title: string
  text?: string
  actions?: Action[]
}

export const getNetworksWithFailedRPCErrors = ({
  providers,
  networks,
  networksWithAssets
}: {
  providers: RPCProviders
  networks: Network[]
  networksWithAssets: AccountAssetsState
}): SelectedAccountBalanceError[] => {
  const errors: SelectedAccountBalanceError[] = []
  const networkIds = getNetworksWithFailedRPC({ providers }).filter(
    (networkId) =>
      (Object.keys(networksWithAssets).includes(networkId) &&
        networksWithAssets[networkId] === true) ||
      !Object.keys(networksWithAssets).includes(networkId)
  )

  const networksData = networkIds.map((id) => networks.find((n: Network) => n.id === id)!)

  const allFailed = networksData.length === networks.length

  const networksWithMultipleRpcUrls = allFailed
    ? []
    : networksData.filter((n) => n?.rpcUrls?.length > 1)

  const networksToGroupInSingleBanner = allFailed
    ? networksData
    : networksData.filter((n) => n?.rpcUrls?.length <= 1)

  if (!networksData.length) return errors

  networksWithMultipleRpcUrls.forEach((n) => {
    errors.push({
      id: `custom-rpcs-down-${n.id}`,
      networkNames: [n.name],
      type: 'error',
      title: `Failed to retrieve network data for ${n.name}. You can try selecting another RPC URL`,
      text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS/UD domain resolving, add account.',
      actions: [
        {
          label: 'Select',
          actionName: 'select-rpc-url',
          meta: { network: n }
        }
      ]
    })
  })

  if (!networksToGroupInSingleBanner.length) return errors

  errors.push({
    id: 'rpcs-down',
    networkNames: networksToGroupInSingleBanner.map((n) => n.name),
    type: 'error',
    title: `Failed to retrieve network data for ${networksToGroupInSingleBanner
      .map((n) => n.name)
      .join(', ')} (RPC malfunction)`,
    text: 'Affected features: visible assets, DeFi positions, sign message/transaction, ENS/UD domain resolving, add account.'
  })

  return errors
}

const addPortfolioError = (
  errors: SelectedAccountBalanceError[],
  networkName: string,
  newError: keyof typeof PORTFOLIO_LIB_ERROR_NAMES | 'portfolio-critical' | 'loading-too-long'
) => {
  const newErrors = [...errors]
  const existingError = newErrors.find((error) => error.id === newError)

  if (existingError) {
    existingError.networkNames.push(networkName)
  } else {
    let title = ''
    let text = ''
    let type: 'error' | 'warning' = 'error'

    switch (newError) {
      case 'portfolio-critical':
        title = 'Failed to retrieve the portfolio data'
        text = 'Account balance and visible assets may be inaccurate.'
        break
      case 'loading-too-long':
        title = 'Loading is taking longer than expected'
        text = 'Account balance and visible assets may be inaccurate.'
        type = 'warning'
        break
      case PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError:
        title = 'Failed to retrieve prices'
        text = 'Account balance and asset prices may be inaccurate.'
        type = 'warning'
        break
      case PORTFOLIO_HINT_ERRORS.NoApiHintsError:
        title = 'Automatic asset discovery is temporarily unavailable'
        text =
          'Your funds are safe, but your portfolio will be inaccurate. You can add assets manually or wait for the issue to be resolved.'
        break
      case PORTFOLIO_HINT_ERRORS.StaleApiHintsError:
        title = 'Automatic asset discovery is temporarily unavailable'
        text =
          'New assets may not be visible in your portfolio. You can add assets manually or wait for the issue to be resolved.'
        type = 'warning'
        break
      default:
        break
    }

    if (!title) return newErrors

    newErrors.push({
      id: newError,
      networkNames: [networkName],
      type,
      title,
      text
    })
  }

  return newErrors
}

export const getNetworksWithPortfolioErrorErrors = ({
  networks,
  selectedAccountLatest,
  providers
}: {
  networks: Network[]
  selectedAccountLatest: SelectedAccountPortfolioState
  providers: RPCProviders
}): SelectedAccountBalanceError[] => {
  let errors: SelectedAccountBalanceError[] = []

  if (!Object.keys(selectedAccountLatest).length) return []

  Object.keys(selectedAccountLatest).forEach((network) => {
    const portfolioForNetwork = selectedAccountLatest[network]
    const criticalError = portfolioForNetwork?.criticalError
    const lastSuccessfulUpdate = portfolioForNetwork?.result?.lastSuccessfulUpdate
    let networkName = networks.find((n) => n.id === network)?.name

    if (network === 'gasTank') networkName = 'Gas Tank'
    else if (network === 'rewards') networkName = 'Rewards'

    if (!networkName) {
      console.error(
        'Network name not found for network in getNetworksWithPortfolioErrorErrors',
        network
      )
      return
    }

    if (portfolioForNetwork?.isLoading) {
      errors = addPortfolioError(errors, networkName, 'loading-too-long')
      return
    }

    // Don't display an error banner if the last successful update was less than 10 minutes ago
    if (typeof lastSuccessfulUpdate === 'number' && Date.now() - lastSuccessfulUpdate < TEN_MINUTES)
      return

    if (!portfolioForNetwork || !network || portfolioForNetwork.isLoading) return
    // Don't display an error banner if the RPC isn't working because an RPC error banner is already displayed.
    // In case of additional networks don't check the RPC as there isn't one
    if (
      criticalError &&
      (['gasTank', 'rewards'].includes(network) || providers[network]?.isWorking)
    ) {
      errors = addPortfolioError(errors, networkName, 'portfolio-critical')
      return
    }

    portfolioForNetwork?.errors.forEach((err: any) => {
      errors = addPortfolioError(errors, networkName as string, err.name)
    })
  })

  return errors.map(({ title, networkNames, ...rest }) => {
    const networkNamesString = networkNames.reduce((acc, name, index) => {
      const isLast = index === networkNames.length - 1
      const isOnly = networkNames.length === 1

      return `${acc}${name}${isLast || isOnly ? '' : ', '}`
    }, '')

    return {
      ...rest,
      title: `${title} on ${networkNamesString}`,
      networkNames
    }
  })
}

export const getNetworksWithDeFiPositionsErrorErrors = ({
  networks,
  currentAccountState,
  providers,
  networksWithPositions
}: {
  networks: Network[]
  currentAccountState: DefiPositionsAccountState
  providers: RPCProviders
  networksWithPositions: NetworksWithPositions
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
    const providersWithPositions = networksWithPositions[networkId]
    // Ignore networks that don't have positions
    // but ensure that we have a successful response stored (the network key is present)
    if (providersWithPositions && !providersWithPositions.length) return

    const networkState = currentAccountState[networkId]
    const network = networks.find((n) => n.id === networkId)
    const rpcProvider = providers[networkId]
    const lastSuccessfulUpdate = networkState.updatedAt

    if (
      !network ||
      !networkState ||
      (typeof lastSuccessfulUpdate === 'number' &&
        Date.now() - lastSuccessfulUpdate < TEN_MINUTES) ||
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

    const providerNamesWithErrors =
      networkState.providerErrors
        ?.filter(({ providerName }) => {
          // Display all errors if there hasn't been a successful update
          // for the network.
          if (!networksWithPositions[networkId]) return true
          // Exclude providers without positions
          return networksWithPositions[networkId].includes(providerName)
        })
        .map((e) => e.providerName) || []

    if (providerNamesWithErrors.length) {
      providerNamesWithErrors.forEach((providerName) => {
        if (!providersWithErrors[providerName]) providersWithErrors[providerName] = []

        providersWithErrors[providerName].push(network.name)
      })
    }
  })

  const providerErrors: SelectedAccountBalanceError[] = Object.entries(providersWithErrors).map(
    ([providerName, networkNames]) => {
      return {
        id: `${providerName}-defi-positions-error`,
        type: 'error',
        networkNames,
        title: `Failed to retrieve DeFi positions for ${providerName} on ${networkNames.join(', ')}`
      }
    }
  )

  const errors = providerErrors

  if (networkNamesWithUnknownCriticalError.length) {
    errors.push({
      id: 'defi-critical',
      type: 'error',
      title: `Failed to retrieve DeFi positions on ${networkNamesWithUnknownCriticalError.join(
        ', '
      )}`,
      networkNames: networkNamesWithUnknownCriticalError
    })
  }
  if (networkNamesWithAssetPriceCriticalError.length) {
    errors.push({
      id: 'defi-prices',
      type: 'warning',
      title: `Failed to retrieve asset prices for DeFi positions on ${networkNamesWithAssetPriceCriticalError.join(
        ', '
      )}`,
      networkNames: networkNamesWithAssetPriceCriticalError
    })
  }

  return errors
}
