import { AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider, RPCProviders } from '../../interfaces/provider'
import { SelectedAccountPortfolioState } from '../../interfaces/selectedAccount'
import {
  AccountState as DefiPositionsAccountState,
  DeFiPositionsError,
  NetworksWithPositions
} from '../defiPositions/types'
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
    | `custom-rpcs-down-${string}`
    | 'rpcs-down'
    | 'portfolio-critical'
    | 'loading-too-long'
    | 'defi-critical'
    | 'defi-prices'
    | `${string}-defi-positions-error`
    | keyof typeof PORTFOLIO_LIB_ERROR_NAMES
  networkNames: string[]
  type: 'error' | 'warning'
  title: string
  text?: string
  actions?: Action[]
}

export const addRPCError = (
  errors: SelectedAccountBalanceError[],
  chainId: string,
  networks: Network[]
) => {
  const newErrors = [...errors]
  const network = networks.find((n) => n.chainId.toString() === chainId)
  if (!network) return newErrors

  const hasMultipleRpcUrls = network.rpcUrls && network.rpcUrls.length > 1
  const errorId: `custom-rpcs-down-${string}` | 'rpcs-down' = hasMultipleRpcUrls
    ? `custom-rpcs-down-${network.chainId.toString()}`
    : 'rpcs-down'
  const networkName = network.name

  const existingError = newErrors.find((error) => error.id === errorId)

  if (existingError) {
    if (!existingError.networkNames.includes(networkName) && !hasMultipleRpcUrls) {
      existingError.networkNames.push(networkName)
      existingError.title = `Failed to retrieve network data for ${existingError.networkNames.join(
        ', '
      )} (RPC malfunction)`
    }
  } else {
    const text =
      'Affected features: visible assets, DeFi positions, sign message/transaction, ENS domain resolving, add account.'
    let title = ''
    let actions: Action[] | undefined

    if (hasMultipleRpcUrls) {
      title = `Failed to retrieve network data for ${networkName}. You can try selecting another RPC URL`
      actions = [
        {
          label: 'Select',
          actionName: 'select-rpc-url',
          meta: { network }
        }
      ]
    } else {
      title = `Failed to retrieve network data for ${networkName} (RPC malfunction)`
    }

    newErrors.push({
      id: errorId,
      networkNames: [networkName],
      type: 'error',
      title,
      text,
      actions
    })
  }

  return newErrors
}

export const addPortfolioError = (
  errors: SelectedAccountBalanceError[],
  networkName: string,
  newError: keyof typeof PORTFOLIO_LIB_ERROR_NAMES | 'portfolio-critical' | 'loading-too-long'
) => {
  const newErrors = [...errors]
  const existingError = newErrors.find((error) => error.id === newError)

  if (existingError) {
    if (!existingError.networkNames.includes(networkName)) {
      existingError.networkNames.push(networkName)
      const networkNames = existingError.networkNames

      const lastIndexOfOn = existingError.title.lastIndexOf(' on ')

      if (lastIndexOfOn !== -1) {
        existingError.title = `${existingError.title.substring(
          0,
          lastIndexOfOn
        )} on ${networkNames.join(', ')}`
      } else {
        existingError.title = `${existingError.title} on ${networkNames.join(', ')}`
      }
    }
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
      case PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError:
        title = 'Automatic asset discovery is temporarily unavailable'
        text =
          'Your funds are safe, but your portfolio will be inaccurate. You can add assets manually or wait for the issue to be resolved.'
        break
      case PORTFOLIO_LIB_ERROR_NAMES.StaleApiHintsError:
        title = 'Automatic asset discovery is temporarily unavailable'
        text =
          'New assets may not be visible in your portfolio. You can add assets manually or wait for the issue to be resolved.'
        type = 'warning'
        break
      default:
        break
    }

    if (!title) return newErrors

    title = `${title} on ${networkName}`

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

const getNetworkName = (networks: Network[], chainId: string) => {
  let networkName = networks.find((n) => n.chainId.toString() === chainId)?.name

  if (chainId === 'gasTank') networkName = 'Gas Tank'
  else if (chainId === 'rewards') networkName = 'Rewards'

  return networkName
}

/**
 * Cases:
 * - All providers are not working - the user is offline and an error should not be displayed
 * - Critical RPC error on Ethereum (displayed immediately, because many things depend on it)
 * - Critical RPC error on other network - displayed after 10 mins of stale account state or portfolio state
 * - Critical portfolio error on any network - displayed after 10 mins of stale portfolio state
 * - Non-critical portfolio error on any network - displayed after 10 mins of stale portfolio state
 */

export const getNetworksWithErrors = ({
  networks,
  selectedAccountLatest,
  providers,
  accountState,
  shouldShowPartialResult,
  isAllReady,
  networksWithAssets
}: {
  networks: Network[]
  selectedAccountLatest: SelectedAccountPortfolioState
  providers: RPCProviders
  accountState: {
    [chainId: string]: AccountOnchainState
  }
  isAllReady: boolean
  shouldShowPartialResult: boolean
  networksWithAssets: AccountAssetsState
}): SelectedAccountBalanceError[] => {
  let errors: SelectedAccountBalanceError[] = []
  const areAllProvidersDown = Object.values(providers).every(
    (provider) => provider?.isWorking === false
  )

  if (!Object.keys(selectedAccountLatest).length || areAllProvidersDown) return []

  networks.forEach((network) => {
    const chainId = network.chainId.toString()
    const portfolioForNetwork = selectedAccountLatest[chainId]
    const accountStateForNetwork = accountState?.[chainId]
    const criticalPortfolioError = portfolioForNetwork?.criticalError
    const isRpcWorking = providers[chainId]?.isWorking !== false
    const lastSuccessfulPortfolioUpdate = portfolioForNetwork?.result?.lastSuccessfulUpdate
    const accountStateUpdatedAt = accountStateForNetwork?.updatedAt
    const networkName = getNetworkName(networks, chainId)
    const isLoadingFromScratch = portfolioForNetwork?.isLoading && !isAllReady

    if (!networkName) {
      console.error('Network name not found for network in getNetworksWithErrors', chainId)
      return
    }

    // No other errors should be displayed if the portfolio is still loading
    // from scratch
    if (isLoadingFromScratch) {
      // The portfolio has been loading for longer than X seconds. The networks
      // that are still loading are the slow ones, so we add a warning for them.
      if (shouldShowPartialResult)
        errors = addPortfolioError(errors, networkName, 'loading-too-long')
      return
    }

    // Add portfolio non-critical errors if the portfolio and RPC are working
    if (!criticalPortfolioError && isRpcWorking) {
      portfolioForNetwork?.errors.forEach((err: any) => {
        errors = addPortfolioError(errors, networkName as string, err.name)
      })
      return
    }

    // Don't display an error banner if the last successful portfolio update was less than 10 minutes ago
    // and the account state was updated less than 10 minutes ago
    if (
      // Skip the 10 minute check for Ethereum as many things depend
      // on the Ethereum RPC working
      chainId !== '1' &&
      typeof lastSuccessfulPortfolioUpdate === 'number' &&
      Date.now() - lastSuccessfulPortfolioUpdate < TEN_MINUTES &&
      accountStateUpdatedAt &&
      Date.now() - accountStateUpdatedAt < TEN_MINUTES
    ) {
      return
    }

    if (!isRpcWorking) {
      // Don't display an error if the user has never had assets on this network
      // but display one if we don't know whether the user has assets on this network
      // Note @petromir: This logic is legacy and I no longer think it's correct. What if
      // the user has never had assets on a network but expects to receive some?
      // I think we should simply increase the timeout above to a higher value (30 mins?)
      // but always display the error on manual reloads.
      if (networksWithAssets?.[chainId] === false) return

      // Add an RPC error if the RPC is not working
      errors = addRPCError(errors, chainId, networks)
      return
    }

    if (criticalPortfolioError) {
      // Add portfolio critical banner
      errors = addPortfolioError(errors, networkName as string, 'portfolio-critical')
    }
  })

  return errors
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
  const isLoading = Object.keys(currentAccountState).some((chainId) => {
    const networkState = currentAccountState[chainId]
    return networkState.isLoading
  })

  if (isLoading) return []

  const networkNamesWithUnknownCriticalError: string[] = []
  const networkNamesWithAssetPriceCriticalError: string[] = []
  const providersWithErrors: {
    [providerName: string]: string[]
  } = {}

  Object.keys(currentAccountState).forEach((chainId) => {
    const providersWithPositions = networksWithPositions[chainId]
    // Ignore networks that don't have positions
    // but ensure that we have a successful response stored (the network key is present)
    if (providersWithPositions && !providersWithPositions.length) return

    const networkState = currentAccountState[chainId]
    const network = networks.find((n) => n.chainId.toString() === chainId)
    const rpcProvider: RPCProvider | undefined = providers[chainId]
    const lastSuccessfulUpdate = networkState.updatedAt

    if (
      !network ||
      !networkState ||
      (typeof lastSuccessfulUpdate === 'number' &&
        Date.now() - lastSuccessfulUpdate < TEN_MINUTES) ||
      // Don't display an error banner if the RPC isn't working because an RPC error banner is already displayed.
      (rpcProvider && typeof rpcProvider.isWorking === 'boolean' && !rpcProvider.isWorking)
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
          if (!networksWithPositions[chainId]) return true
          // Exclude providers without positions
          return networksWithPositions[chainId].includes(providerName)
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
