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
  NetworkState,
  TokenResult
} from '../portfolio/interfaces'

export const updatePortfolioStateWithDefiPositions = (
  portfolioAccountState: AccountState,
  defiPositionsAccountState: DefiPositionsAccountState,
  areDefiPositionsLoading: boolean
) => {
  if (!portfolioAccountState || !defiPositionsAccountState || areDefiPositionsLoading)
    return portfolioAccountState

  Object.keys(portfolioAccountState).forEach((chainId) => {
    const networkState = portfolioAccountState[chainId]

    if (!networkState?.result || defiPositionsAccountState[chainId]?.isLoading) return

    const tokens = networkState.result.tokens || []
    let networkBalance = networkState.result.total?.usd || 0

    const positions = defiPositionsAccountState[chainId] || {}

    positions.positionsByProvider?.forEach((posByProv: PositionsByProvider) => {
      if (posByProv.type === 'liquidity-pool') {
        networkBalance += posByProv.positionInUSD || 0
        return
      }

      posByProv.positions.forEach((pos) => {
        pos.assets
          .filter((a) => a.type !== AssetType.Liquidity && a.protocolAsset)
          .forEach((a) => {
            const tokenInPortfolio = tokens.find((t) => {
              return (
                t.address.toLowerCase() === (a.protocolAsset?.address || '').toLowerCase() &&
                t.chainId.toString() === chainId &&
                !t.flags.rewardsType &&
                !t.flags.onGasTank
              )
            })

            if (tokenInPortfolio?.flags.isHidden) return

            // Add only the balance of the collateral tokens to the network balance
            if (a.type === AssetType.Collateral) {
              const protocolPriceUSD = a.priceIn.find(
                ({ baseCurrency }: { baseCurrency: string }) => baseCurrency.toLowerCase() === 'usd'
              )?.price

              const protocolTokenBalanceUSD = protocolPriceUSD
                ? Number(
                    safeTokenAmountAndNumberMultiplication(
                      BigInt(tokenInPortfolio?.amountPostSimulation || a.amount),
                      Number(a.protocolAsset!.decimals),
                      protocolPriceUSD
                    )
                  )
                : undefined

              networkBalance += protocolTokenBalanceUSD || 0
            }

            if (tokenInPortfolio) {
              const priceUSD = tokenInPortfolio.priceIn.find(
                ({ baseCurrency }: { baseCurrency: string }) => baseCurrency.toLowerCase() === 'usd'
              )?.price

              const tokenBalanceUSD = priceUSD
                ? Number(
                    safeTokenAmountAndNumberMultiplication(
                      BigInt(tokenInPortfolio.amountPostSimulation || tokenInPortfolio.amount),
                      tokenInPortfolio.decimals,
                      priceUSD
                    )
                  )
                : undefined

              networkBalance -= tokenBalanceUSD || 0 // deduct portfolio token balance
              // Get the price from defiPositions
              tokenInPortfolio.priceIn = a.type === AssetType.Collateral ? a.priceIn : []
            } else {
              const positionAsset: TokenResult = {
                amount: a.amount,
                // Only list the borrowed asset with no price
                priceIn: a.type === AssetType.Collateral ? a.priceIn : [],
                decimals: Number(a.protocolAsset!.decimals),
                address: a.protocolAsset!.address,
                symbol: a.protocolAsset!.symbol,
                name: a.protocolAsset!.name,
                chainId: BigInt(chainId),
                flags: {
                  canTopUpGasTank: false,
                  isFeeToken: false,
                  onGasTank: false,
                  rewardsType: null,
                  isDefiToken: true
                  // @BUG: defi positions tokens can't be hidden and can be added as custom
                  // because processTokens is called in the portfolio
                  // Issue: https://github.com/AmbireTech/ambire-app/issues/3971
                }
              }

              tokens.push(positionAsset)
            }
          })
      })
    })

    // eslint-disable-next-line no-param-reassign
    portfolioAccountState[chainId]!.result!.total.usd = networkBalance
    // eslint-disable-next-line no-param-reassign
    portfolioAccountState[chainId]!.result!.tokens = tokens
  })

  return portfolioAccountState
}

const stripPortfolioState = (portfolioState: AccountState) => {
  const strippedState: SelectedAccountPortfolioState = {}

  Object.keys(portfolioState).forEach((chainId) => {
    const networkState = portfolioState[chainId]
    if (!networkState) return

    if (!networkState.result) {
      strippedState[chainId] = networkState
      return
    }

    // A trick to exclude specific keys
    const { tokens, collections, tokenErrors, priceCache, hintsFromExternalAPI, ...result } =
      networkState.result

    strippedState[chainId] = { ...networkState, result }
  })

  return strippedState
}

export const isNetworkReady = (networkData: NetworkState | undefined) => {
  return networkData && (networkData.isReady || networkData?.criticalError)
}

const calculateTokenArray = (
  chainId: string,
  latestTokens: TokenResult[],
  pendingTokens: TokenResult[],
  isPendingValid: boolean
) => {
  if (chainId === 'gasTank' || chainId === 'rewards') {
    return latestTokens
  }
  // If the pending state is older or there are no pending tokens
  // we shouldn't trust it to build the tokens array
  if (isPendingValid && pendingTokens.length) {
    return pendingTokens.map((pendingToken) => {
      const latestToken = latestTokens.find((latest) => {
        return latest.address === pendingToken.address
      })

      return {
        ...pendingToken,
        latestAmount: latestToken?.amount,
        pendingAmount: pendingToken.amount
      }
    })
  }

  // Add only latestAmount to the tokens
  return latestTokens.map((token) => {
    return {
      ...token,
      latestAmount: token.amount
    }
  })
}

export function calculateSelectedAccountPortfolio(
  latestStateSelectedAccount: AccountState,
  pendingStateSelectedAccount: AccountState,
  accountPortfolio: SelectedAccountPortfolio | null,
  portfolioStartedLoadingAtTimestamp: number | null,
  defiPositionsAccountState: DefiPositionsAccountState,
  hasSignAccountOp: boolean,
  isLoadingFromScratch: boolean
): SelectedAccountPortfolio {
  const now = Date.now()
  const shouldShowPartialResult =
    portfolioStartedLoadingAtTimestamp && now - portfolioStartedLoadingAtTimestamp > 5000
  const collections: CollectionResult[] = []
  const tokens: SelectedAccountPortfolioTokenResult[] = []

  let newTotalBalance: number = 0

  const hasLatest = latestStateSelectedAccount && Object.keys(latestStateSelectedAccount).length
  let isAllReady = !!hasLatest
  let isReadyToVisualize = false

  const hasPending = pendingStateSelectedAccount && Object.keys(pendingStateSelectedAccount).length
  if (!hasLatest && !hasPending) {
    return {
      tokens: accountPortfolio?.tokens || [],
      collections: accountPortfolio?.collections || [],
      totalBalance: accountPortfolio?.totalBalance || 0,
      isReadyToVisualize: false,
      isAllReady: false,
      networkSimulatedAccountOp: accountPortfolio?.networkSimulatedAccountOp || {},
      latest: latestStateSelectedAccount,
      pending: pendingStateSelectedAccount
    }
  }

  let selectedAccountData = latestStateSelectedAccount

  /**
   * Replaces the latest state if the following conditions are true:
   * - There is no critical error in the pending state.
   * - The pending block number is newer than the latest OR we have a signed acc op (because of simulation).
   */
  const validSelectedAccountPendingState: AccountState = {}
  const simulatedAccountOps: NetworkSimulatedAccountOp = {}

  Object.keys(pendingStateSelectedAccount).forEach((network) => {
    const pendingNetworkData = pendingStateSelectedAccount[network]
    const latestNetworkData = latestStateSelectedAccount[network]

    // Compare the block numbers to determine if the pending state is newer
    if (latestNetworkData?.result?.blockNumber && pendingNetworkData?.result?.blockNumber) {
      const isPendingNewer =
        pendingNetworkData.result.blockNumber! >= latestNetworkData.result.blockNumber!

      if (!pendingNetworkData.criticalError && (isPendingNewer || hasSignAccountOp)) {
        validSelectedAccountPendingState[network] = pendingNetworkData
      }
    }

    // Store the simulated account op
    const accountOp = pendingNetworkData?.accountOps?.[0]

    if (accountOp) {
      simulatedAccountOps[network] = accountOp
    }
  })

  if (hasPending && Object.keys(validSelectedAccountPendingState).length > 0) {
    selectedAccountData = {
      ...selectedAccountData,
      ...validSelectedAccountPendingState
    }
  }

  Object.keys(selectedAccountData).forEach((network: string) => {
    const networkData = selectedAccountData[network]
    const result = networkData?.result

    if (networkData && result) {
      const networkTotal = Number(result?.total?.usd) || 0
      newTotalBalance += networkTotal

      const latestTokens = latestStateSelectedAccount[network]?.result?.tokens || []
      const pendingTokens = pendingStateSelectedAccount[network]?.result?.tokens || []
      const networkCollections = result?.collections || []

      const tokensArray = calculateTokenArray(
        network,
        latestTokens,
        pendingTokens,
        !!validSelectedAccountPendingState[network]
      )

      tokens.push(...tokensArray)
      collections.push(...networkCollections)
    }

    if (
      // The network is not ready
      !isNetworkReady(networkData) ||
      // The networks is ready but the previous state isn't satisfactory and the network is still loading
      (isLoadingFromScratch && networkData?.isLoading) ||
      // The total balance and token list are affected by the defi positions
      defiPositionsAccountState[network]?.isLoading
    ) {
      isAllReady = false
    }
  })

  const tokensWithAmount = tokens.filter((token) => token.amount)

  if ((shouldShowPartialResult && tokensWithAmount.length && !isAllReady) || isAllReady) {
    // Allow the user to operate with the tokens that have loaded
    isReadyToVisualize = true
  }

  return {
    totalBalance: newTotalBalance,
    tokens,
    collections,
    isReadyToVisualize,
    isAllReady,
    networkSimulatedAccountOp: simulatedAccountOps,
    latest: stripPortfolioState(latestStateSelectedAccount),
    pending: stripPortfolioState(pendingStateSelectedAccount)
  } as SelectedAccountPortfolio
}
