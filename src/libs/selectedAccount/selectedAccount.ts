import { getAddress } from 'ethers'

import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioState,
  SelectedAccountPortfolioTokenResult
} from '../../interfaces/selectedAccount'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'
import {
  AccountState as DefiPositionsAccountState,
  AssetType,
  PositionsByProvider
} from '../defiPositions/types'
import {
  AccountState,
  CollectionResult,
  NetworkSimulatedAccountOp,
  NetworkState
} from '../portfolio/interfaces'

export const updatePortfolioStateWithDefiPositions = (
  portfolioAccountState: AccountState,
  defiPositionsAccountState: DefiPositionsAccountState,
  areDefiPositionsLoading: boolean
) => {
  if (!portfolioAccountState || !defiPositionsAccountState || areDefiPositionsLoading)
    return portfolioAccountState

  Object.keys(portfolioAccountState).forEach((networkId) => {
    const networkState = portfolioAccountState[networkId]

    if (!networkState?.result || defiPositionsAccountState[networkId]?.isLoading) return

    let tokens = networkState.result.tokens || []
    let networkBalance = networkState.result.total?.usd || 0

    const positions = defiPositionsAccountState[networkId] || {}

    positions.positionsByProvider?.forEach((posByProv: PositionsByProvider) => {
      if (posByProv.type === 'liquidity-pool') {
        networkBalance += posByProv.positionInUSD || 0
        return
      }

      posByProv.positions.forEach((pos) => {
        pos.assets
          .filter((a) => a.type !== AssetType.Liquidity && a.protocolAsset)
          .forEach((a) => {
            const tokenInPortfolioIndex = tokens.findIndex((t) => {
              return (
                getAddress(t.address) === getAddress(a.protocolAsset!.address) &&
                t.networkId === networkId
              )
            })

            if (tokenInPortfolioIndex !== -1) {
              const tokenInPortfolio = tokens[tokenInPortfolioIndex]
              const priceUSD = tokenInPortfolio.priceIn.find(
                ({ baseCurrency }: { baseCurrency: string }) => baseCurrency.toLowerCase() === 'usd'
              )?.price
              const tokenBalanceUSD = priceUSD
                ? Number(
                    safeTokenAmountAndNumberMultiplication(
                      BigInt(tokenInPortfolio.amount),
                      tokenInPortfolio.decimals,
                      priceUSD
                    )
                  )
                : undefined

              networkBalance -= tokenBalanceUSD || 0 // deduct portfolio token balance
              tokens = tokens.filter((_, index) => index !== tokenInPortfolioIndex)
            }

            // Add only the balance of the collateral tokens to the network balance
            if (a.type === AssetType.Collateral) {
              const protocolPriceUSD = a.priceIn.find(
                ({ baseCurrency }: { baseCurrency: string }) => baseCurrency.toLowerCase() === 'usd'
              )?.price

              const protocolTokenBalanceUSD = protocolPriceUSD
                ? Number(
                    safeTokenAmountAndNumberMultiplication(
                      BigInt(a.amount),
                      Number(a.protocolAsset!.decimals),
                      protocolPriceUSD
                    )
                  )
                : undefined

              networkBalance += protocolTokenBalanceUSD || 0
            }
            tokens.push({
              amount: a.amount,
              // Only list the borrowed asset with no price
              priceIn: a.type === AssetType.Collateral ? a.priceIn : [],
              decimals: Number(a.protocolAsset!.decimals),
              address: a.protocolAsset!.address,
              symbol: a.protocolAsset!.symbol,
              networkId,
              flags: {
                canTopUpGasTank: false,
                isFeeToken: false,
                onGasTank: false,
                rewardsType: null
              }
            })
          })
      })
    })

    // eslint-disable-next-line no-param-reassign
    portfolioAccountState[networkId]!.result!.total.usd = networkBalance
    // eslint-disable-next-line no-param-reassign
    portfolioAccountState[networkId]!.result!.tokens = tokens
  })

  return portfolioAccountState
}

const stripPortfolioState = (portfolioState: AccountState) => {
  const strippedState: SelectedAccountPortfolioState = {}

  Object.keys(portfolioState).forEach((networkId) => {
    const networkState = portfolioState[networkId]
    if (!networkState) return

    if (!networkState.result) {
      strippedState[networkId] = networkState
      return
    }

    // A trick to exclude specific keys
    const { tokens, collections, tokenErrors, priceCache, hintsFromExternalAPI, ...result } =
      networkState.result

    strippedState[networkId] = {
      ...networkState,
      result
    }
  })

  return strippedState
}

const isNetworkReady = (networkData: NetworkState | undefined) => {
  return (
    networkData && (networkData.isReady || networkData?.criticalError) && !networkData.isLoading
  )
}

export function calculateSelectedAccountPortfolio(
  latestStateSelectedAccount: AccountState,
  pendingStateSelectedAccount: AccountState,
  accountPortfolio: SelectedAccountPortfolio | null,
  hasSignAccountOp?: boolean
) {
  const updatedCollections: CollectionResult[] = []

  let newTotalBalance: number = 0

  const hasLatest = latestStateSelectedAccount && Object.keys(latestStateSelectedAccount).length
  let allReady = !!hasLatest

  const hasPending = pendingStateSelectedAccount && Object.keys(pendingStateSelectedAccount).length
  if (!hasLatest && !hasPending) {
    return {
      tokens: accountPortfolio?.tokens || [],
      collections: accountPortfolio?.collections || [],
      totalBalance: accountPortfolio?.totalBalance || 0,
      isAllReady: false,
      networkSimulatedAccountOp: accountPortfolio?.networkSimulatedAccountOp || {},
      latest: latestStateSelectedAccount,
      pending: pendingStateSelectedAccount
    } as SelectedAccountPortfolio
  }

  let selectedAccountData = latestStateSelectedAccount

  const pendingAccountStateWithoutCriticalErrors = Object.keys(pendingStateSelectedAccount).reduce(
    (acc, network) => {
      if (
        !selectedAccountData[network]?.result?.blockNumber ||
        !pendingStateSelectedAccount[network]?.result?.blockNumber
      )
        return acc

      // Filter out networks with critical errors.
      // Additionally, use the pending state if either of the following conditions is true:
      // - The pending block number is newer than the latest. Keep in mind that we always update both the latest and pending portfolio state,
      //   regardless of whether we have an acc op for simulation or not. Because of this, if the pending state is newer, we use it in place of the latest state.
      // - We have a signed acc op, meaning we are performing a simulation and want to visualize pending badges (pending-to-be-confirmed and pending-to-be-signed).
      const isPendingNewer =
        pendingStateSelectedAccount[network]?.result?.blockNumber! >=
        selectedAccountData[network]?.result?.blockNumber!

      if (
        !pendingStateSelectedAccount[network]?.criticalError &&
        (isPendingNewer || hasSignAccountOp)
      ) {
        acc[network] = pendingStateSelectedAccount[network]
      }
      return acc
    },
    {} as AccountState
  )

  if (hasPending && Object.keys(pendingAccountStateWithoutCriticalErrors).length > 0) {
    // Mix latest and pending data. This is required because pending state may only have some networks
    selectedAccountData = {
      ...selectedAccountData,
      ...pendingAccountStateWithoutCriticalErrors
    }
  }

  Object.keys(selectedAccountData).forEach((network: string) => {
    const networkData = selectedAccountData[network]
    const result = networkData?.result
    if (networkData && isNetworkReady(networkData) && result) {
      // In the case we receive BigInt here, convert to number
      const networkTotal = Number(result?.total?.usd) || 0
      newTotalBalance += networkTotal

      const networkCollections = result?.collections || []

      updatedCollections.push(...networkCollections)
    }

    if (!isNetworkReady(networkData)) {
      allReady = false
    }
  })

  // For the selected account's pending state, create a SimulationNonces mapping,
  // which associates each network with its corresponding pending simulation beforeNonce.
  // This nonce information is crucial for determining the PendingToBeSigned or PendingToBeConfirmed Dashboard badges.
  // For more details, see: calculatePendingAmounts.
  const networkSimulatedAccountOp = Object.keys(pendingStateSelectedAccount).reduce(
    (acc, networkId) => {
      const accountOp = pendingStateSelectedAccount[networkId]?.accountOps?.[0]
      if (accountOp) {
        acc[networkId] = accountOp
      }

      return acc
    },
    {} as NetworkSimulatedAccountOp
  )

  const newTokens = Object.keys(pendingStateSelectedAccount).reduce((acc, networkId) => {
    const pendingTokens = pendingStateSelectedAccount[networkId]?.result?.tokens

    if (!pendingTokens) return acc

    const mergedTokens = pendingTokens.map((pendingToken) => {
      const latestToken = latestStateSelectedAccount[networkId]?.result?.tokens.find((latest) => {
        return latest.address === pendingToken.address
      })

      return {
        ...pendingToken,
        latestAmount: latestToken?.amount,
        pendingAmount: pendingToken.amount
      }
    })

    return [...acc, ...mergedTokens]
  }, [] as SelectedAccountPortfolioTokenResult[])

  return {
    totalBalance: newTotalBalance,
    tokens: newTokens,
    collections: updatedCollections,
    isAllReady: allReady,
    networkSimulatedAccountOp,
    latest: stripPortfolioState(latestStateSelectedAccount),
    pending: stripPortfolioState(pendingStateSelectedAccount)
  } as SelectedAccountPortfolio
}
